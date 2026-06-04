import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockUseSWRInfinite } = vi.hoisted(() => ({
  mockUseSWRInfinite: vi.fn(),
}));
vi.mock("swr/infinite", () => ({ default: mockUseSWRInfinite }));
vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import { useAllClientCheckIns } from "./use-check-in-data";

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
