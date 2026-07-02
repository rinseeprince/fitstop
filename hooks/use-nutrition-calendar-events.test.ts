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

import {
  useNutritionCalendarEvents,
  useInvalidateNutritionCalendar,
} from "./use-nutrition-calendar-events";

beforeEach(() => {
  mutateMock.mockClear();
  swrSubscribeMock.mockClear();
});

describe("useInvalidateNutritionCalendar", () => {
  function getPredicate(clientId: string): (key: unknown) => boolean {
    const { result } = renderHook(() => useInvalidateNutritionCalendar());
    void result.current(clientId);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const predicate = mutateMock.mock.calls[0][0];
    expect(typeof predicate).toBe("function");
    return predicate;
  }

  it("matches every cached month window of the client's events key", () => {
    const predicate = getPredicate("c1");
    expect(
      predicate("/api/clients/c1/nutrition/events?startDate=2026-06-29&endDate=2026-08-02")
    ).toBe(true);
    expect(
      predicate("/api/clients/c1/nutrition/events?startDate=2026-07-27&endDate=2026-09-06")
    ).toBe(true);
  });

  it("rejects other clients' keys", () => {
    const predicate = getPredicate("c1");
    expect(
      predicate("/api/clients/c2/nutrition/events?startDate=2026-06-29&endDate=2026-08-02")
    ).toBe(false);
  });

  it("rejects non-events nutrition keys and unrelated keys", () => {
    const predicate = getPredicate("c1");
    expect(predicate("/api/clients/c1/history/nutrition")).toBe(false);
    expect(predicate("/api/clients/c1/nutrition")).toBe(false);
    expect(predicate("/api/clients/c1/training/events?startDate=x&endDate=y")).toBe(false);
  });

  it("rejects non-string keys", () => {
    const predicate = getPredicate("c1");
    expect(predicate(undefined)).toBe(false);
    expect(predicate(["/api/clients/c1/nutrition/events?", "extra"])).toBe(false);
  });

  it("accepts the exact key useNutritionCalendarEvents subscribes with (drift guard)", () => {
    renderHook(() =>
      useNutritionCalendarEvents("c1", "2026-06-29", "2026-08-02")
    );
    const subscribedKey = swrSubscribeMock.mock.calls[0][0] as string;
    expect(subscribedKey).toBe(
      "/api/clients/c1/nutrition/events?startDate=2026-06-29&endDate=2026-08-02"
    );

    const predicate = getPredicate("c1");
    expect(predicate(subscribedKey)).toBe(true);
  });
});
