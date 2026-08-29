import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockUseSWR, mockUseSWRInfinite, mockUseSWRConfig } = vi.hoisted(() => ({
  mockUseSWR: vi.fn(),
  mockUseSWRInfinite: vi.fn(),
  mockUseSWRConfig: vi.fn(),
}));
vi.mock("swr/infinite", () => ({ default: mockUseSWRInfinite }));
vi.mock("swr", () => ({ default: mockUseSWR, useSWRConfig: mockUseSWRConfig }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import {
  checkInsQueueKey,
  useAllClientCheckIns,
  useInvalidateCheckInsQueue,
  useInvalidateClientCheckIns,
  useUnreviewedCheckIns,
} from "./use-check-in-data";

describe("useAllClientCheckIns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flattens loaded pages and reports the total", () => {
    mockUseSWRInfinite.mockReturnValue({
      data: [{ checkIns: [{ id: "a" }, { id: "b" }], total: 2 }],
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: false,
    });

    const { result } = renderHook(() => useAllClientCheckIns("client-1"));

    expect(result.current.checkIns).toHaveLength(2);
    expect(result.current.total).toBe(2);
    expect(result.current.isLoading).toBe(false);
  });

  it("auto-advances the page size while more history remains", () => {
    const setSize = vi.fn();
    mockUseSWRInfinite.mockReturnValue({
      data: [{ checkIns: new Array(20).fill({ id: "x" }), total: 50 }],
      error: undefined,
      size: 1,
      setSize,
      isLoading: false,
    });

    const { result } = renderHook(() => useAllClientCheckIns("client-1"));

    // 20 of 50 loaded → still "loading" and it requests the next page.
    expect(result.current.isLoading).toBe(true);
    expect(setSize).toHaveBeenCalled();
  });

  it("surfaces the error and stops 'loading' when a page fails mid-stream", () => {
    // page 0 loaded (20 of 50), page 1 errored — must not spin forever.
    mockUseSWRInfinite.mockReturnValue({
      data: [{ checkIns: new Array(20).fill({ id: "x" }), total: 50 }],
      error: new Error("boom"),
      size: 2,
      setSize: vi.fn(),
      isLoading: false,
    });

    const { result } = renderHook(() => useAllClientCheckIns("client-1"));

    expect(result.current.isError).toBeTruthy();
    expect(result.current.isLoading).toBe(false);
  });

  it("stops paging once the full history is loaded", () => {
    const setSize = vi.fn();
    mockUseSWRInfinite.mockReturnValue({
      data: [{ checkIns: new Array(2).fill({ id: "x" }), total: 2 }],
      error: undefined,
      size: 1,
      setSize,
      isLoading: false,
    });

    const { result } = renderHook(() => useAllClientCheckIns("client-1"));

    expect(result.current.isLoading).toBe(false);
    expect(setSize).not.toHaveBeenCalled();
  });
});

type KeyFilter = (key: unknown) => boolean;

function unresolvedSWR() {
  mockUseSWR.mockReturnValue({
    data: undefined,
    error: undefined,
    isLoading: true,
    mutate: vi.fn(),
  });
}

describe("useUnreviewedCheckIns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the exported queue key", () => {
    unresolvedSWR();

    renderHook(() => useUnreviewedCheckIns());

    expect(checkInsQueueKey).toBe("/api/check-ins/unreviewed");
    expect(mockUseSWR.mock.calls[0][0]).toBe(checkInsQueueKey);
  });

  it("hands back one stable empty list while the fetch is unresolved", () => {
    unresolvedSWR();

    const { result, rerender } = renderHook(() => useUnreviewedCheckIns());
    const first = result.current.checkIns;
    rerender();

    expect(first).toEqual([]);
    // The toast listener's effect is keyed on this array; a fresh [] per
    // render would re-run it.
    expect(result.current.checkIns).toBe(first);
  });
});

describe("useInvalidateCheckInsQueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revalidates the whole /api/check-ins area and nothing beside it", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    mockUseSWRConfig.mockReturnValue({ mutate });

    const { result } = renderHook(() => useInvalidateCheckInsQueue());
    await result.current();

    expect(mutate).toHaveBeenCalledTimes(1);
    // A plain revalidate: the filter alone, no data, no options.
    expect(mutate.mock.calls[0]).toHaveLength(1);
    const filter = mutate.mock.calls[0][0] as KeyFilter;
    expect(filter("/api/check-ins/unreviewed")).toBe(true);
    expect(filter("/api/check-ins/recent")).toBe(true);
    // The singular per-check-in detail area is a different area.
    expect(filter("/api/check-in/ci-1")).toBe(false);
    expect(filter("/api/clients/c1/check-ins?limit=20&offset=0")).toBe(false);
    expect(filter(null)).toBe(false);
    expect(filter(["/api/check-ins/unreviewed", 1])).toBe(false);
  });
});

describe("useInvalidateClientCheckIns", () => {
  beforeEach(() => vi.clearAllMocks());

  async function invalidate(clientId: string) {
    const mutate = vi.fn().mockResolvedValue(undefined);
    mockUseSWRConfig.mockReturnValue({ mutate });
    const { result } = renderHook(() => useInvalidateClientCheckIns());
    await result.current(clientId);
    return mutate;
  }

  it("revalidates the client's area with a plain mutate", async () => {
    const mutate = await invalidate("c1");

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[0]).toHaveLength(1);
    const area = mutate.mock.calls[0][0] as KeyFilter;
    expect(area("/api/clients/c1/check-ins?limit=20&offset=0")).toBe(true);
    expect(area("/api/clients/c1/check-ins?limit=20&offset=20")).toBe(true);
    expect(area("/api/clients/c2/check-ins?limit=20&offset=0")).toBe(false);
    expect(area("/api/clients/c1/check-in-config")).toBe(false);
    expect(area("/api/clients/c1")).toBe(false);
    expect(area(undefined)).toBe(false);
  });

  it("clears the infinite page caches without refetching, and only those", async () => {
    const mutate = await invalidate("c1");

    const [pages, data, opts] = mutate.mock.calls[1] as [KeyFilter, unknown, unknown];
    expect(data).toBeUndefined();
    expect(opts).toEqual({ revalidate: false });
    expect(pages("/api/clients/c1/check-ins?limit=20&offset=0")).toBe(true);
    expect(pages("/api/clients/c2/check-ins?limit=20&offset=0")).toBe(false);
    // A plain read under the area is never blanked — this leg would leave it
    // empty with no refetch.
    expect(pages("/api/clients/c1/check-ins")).toBe(false);
  });

  it("clears exactly the keys the infinite readers build", async () => {
    mockUseSWRInfinite.mockReturnValue({
      data: undefined,
      error: undefined,
      size: 1,
      setSize: vi.fn(),
      isLoading: true,
    });
    renderHook(() => useAllClientCheckIns("c1"));
    const getKey = mockUseSWRInfinite.mock.calls[0][0] as (
      index: number,
      previous: unknown
    ) => string | null;
    const page0 = getKey(0, null);
    const page1 = getKey(1, { checkIns: [{ id: "x" }], total: 40 });

    const mutate = await invalidate("c1");
    const pages = mutate.mock.calls[1][0] as KeyFilter;

    expect(page0).toBeTruthy();
    expect(page1).toBeTruthy();
    expect(pages(page0)).toBe(true);
    expect(pages(page1)).toBe(true);
  });
});
