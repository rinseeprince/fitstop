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

import { useInvalidateWellnessSeries, useWellnessSeries } from "./use-wellness-series";

beforeEach(() => {
  mutateMock.mockClear();
  swrSubscribeMock.mockClear();
});

describe("useInvalidateWellnessSeries", () => {
  function getPredicate(clientId: string): (key: unknown) => boolean {
    const { result } = renderHook(() => useInvalidateWellnessSeries());
    void result.current(clientId);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const predicate = mutateMock.mock.calls[0][0];
    expect(typeof predicate).toBe("function");
    return predicate;
  }

  it("matches the client's wellness-series area", () => {
    const predicate = getPredicate("c1");
    expect(predicate("/api/clients/c1/wellness-series")).toBe(true);
  });

  it("rejects other clients' keys", () => {
    const predicate = getPredicate("c1");
    expect(predicate("/api/clients/c2/wellness-series")).toBe(false);
  });

  it("rejects the sibling series and the other wellness readers — each is its own area", () => {
    const predicate = getPredicate("c1");
    expect(predicate("/api/clients/c1/measurement-series")).toBe(false);
    expect(predicate("/api/clients/c1/daily-logs?startDate=2026-08-20&endDate=2026-09-02")).toBe(false);
    expect(predicate("/api/clients/c1/history/wellness")).toBe(false);
    expect(predicate("/api/clients/c1/history/wellness/summary?days=7")).toBe(false);
    expect(predicate("/api/clients/c1/metric-entries")).toBe(false);
  });

  it("rejects non-string keys", () => {
    const predicate = getPredicate("c1");
    expect(predicate(undefined)).toBe(false);
    expect(predicate(["/api/clients/c1/wellness-series", "extra"])).toBe(false);
  });

  it("accepts the exact key useWellnessSeries subscribes with (drift guard)", () => {
    renderHook(() => useWellnessSeries("c1"));
    const subscribedKey = swrSubscribeMock.mock.calls[0][0] as string;
    expect(subscribedKey).toBe("/api/clients/c1/wellness-series");

    const predicate = getPredicate("c1");
    expect(predicate(subscribedKey)).toBe(true);
  });
});

describe("useWellnessSeries", () => {
  it("subscribes with no key until it has a client id", () => {
    renderHook(() => useWellnessSeries(""));
    expect(swrSubscribeMock.mock.calls[0][0]).toBeNull();
  });

  it("hands back the payload under `series`, null while nothing has arrived", () => {
    const { result } = renderHook(() => useWellnessSeries("c1"));
    expect(result.current.series).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});
