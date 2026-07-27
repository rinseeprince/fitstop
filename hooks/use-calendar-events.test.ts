import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mutateMock = vi.fn();
const swrSubscribeMock = vi.fn((..._args: unknown[]) => ({
  data: undefined,
  error: undefined,
  isLoading: false,
  mutate: vi.fn(),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => swrSubscribeMock(...args),
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import { useCalendarEvents, useInvalidateTrainingData } from "./use-calendar-events";

beforeEach(() => {
  mutateMock.mockClear();
  swrSubscribeMock.mockClear();
});

describe("useInvalidateTrainingData", () => {
  function getPredicate(clientId: string): (key: unknown) => boolean {
    const { result } = renderHook(() => useInvalidateTrainingData());
    void result.current(clientId);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const predicate = mutateMock.mock.calls[0][0];
    expect(typeof predicate).toBe("function");
    return predicate;
  }

  it("matches every cached month window of the client's calendar", () => {
    const predicate = getPredicate("c1");
    expect(
      predicate("/api/clients/c1/training/events?startDate=2026-06-29&endDate=2026-08-02")
    ).toBe(true);
    expect(
      predicate("/api/clients/c1/training/events?startDate=2026-07-27&endDate=2026-09-06")
    ).toBe(true);
  });

  it("matches the plan editor's amendment read — the reader the old prefix missed", () => {
    // The whole point of widening from `…/training/events?` to `…/training`.
    // Saving a session's exercises from the calendar left this key stale, so
    // "Edit plan" showed pre-edit data until a hard browser refresh.
    const predicate = getPredicate("c1");
    expect(predicate("/api/clients/c1/training/plan-9/amendment")).toBe(true);
  });

  it("matches the placed-session tray's read", () => {
    const predicate = getPredicate("c1");
    expect(predicate("/api/clients/c1/training/plan-9/sessions/session-3")).toBe(true);
  });

  it("rejects other clients' keys", () => {
    const predicate = getPredicate("c1");
    expect(predicate("/api/clients/c2/training/events?startDate=2026-06-29&endDate=2026-08-02")).toBe(false);
    expect(predicate("/api/clients/c2/training/plan-9/amendment")).toBe(false);
  });

  it("stays inside the training area", () => {
    const predicate = getPredicate("c1");
    expect(predicate("/api/clients/c1/nutrition/events?startDate=x&endDate=y")).toBe(false);
    expect(predicate("/api/clients/c1/history/training/summary")).toBe(false);
    expect(predicate("/api/clients/c1/overview-plan-summary")).toBe(false);
  });

  it("rejects non-string keys", () => {
    const predicate = getPredicate("c1");
    expect(predicate(undefined)).toBe(false);
    expect(predicate(["/api/clients/c1/training", "extra"])).toBe(false);
  });

  it("accepts the exact key useCalendarEvents subscribes with (drift guard)", () => {
    renderHook(() => useCalendarEvents("c1", "2026-06-29", "2026-08-02"));
    const subscribedKey = swrSubscribeMock.mock.calls[0][0] as string;
    expect(subscribedKey).toBe(
      "/api/clients/c1/training/events?startDate=2026-06-29&endDate=2026-08-02"
    );

    const predicate = getPredicate("c1");
    expect(predicate(subscribedKey)).toBe(true);
  });
});
