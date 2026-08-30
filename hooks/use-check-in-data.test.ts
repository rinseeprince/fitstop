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

import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { CLIENT_CHECKINS_PAGE_SIZE } from "@/lib/constants";
import {
  checkInsQueueKey,
  useAllClientCheckIns,
  useClientCheckInsInfinite,
  useInvalidateCheckInsQueue,
  useInvalidateClientCheckIns,
  useUnreviewedCheckIns,
} from "./use-check-in-data";

describe("useAllClientCheckIns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flattens loaded pages and reports the total", () => {
    mockUseSWRInfinite.mockReturnValue({
      data: [{ checkIns: [{ id: "a" }, { id: "b" }], total: 2, hasMore: false }],
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
      // "more remains" is the PAGE's own flag now, not `length < total`.
      data: [{ checkIns: new Array(20).fill({ id: "x" }), total: 50, hasMore: true }],
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
      data: [{ checkIns: new Array(20).fill({ id: "x" }), total: 50, hasMore: true }],
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
      data: [{ checkIns: new Array(2).fill({ id: "x" }), total: 2, hasMore: false }],
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

// ---------------------------------------------------------------------------
// The pagination contract (C7).
//
// These exercise the shared SWRInfinite KEY BUILDER, because the defect they
// guard is a property of the key derivation and of nothing else. An offset key
// says "rows 20-39 of the list as it is right now", so two pages fetched either
// side of an insert at the head describe two different lists and the flattened
// result repeats a row (the duplicate React key) or skips one. A cursor key says
// "the rows after THIS row", which is true whenever it is read.
//
// The scenarios below are the two orderings that reach it. Neither is a replay
// of a specific reported incident — the claim under test is the code property.
// ---------------------------------------------------------------------------

type Row = { id: string; created_at: string };
type Page = {
  checkIns: Row[];
  total?: number;
  nextCursor: string | null;
  hasMore: boolean;
};

// A real UUID, so the cursor round-trips through lib/cursor's strict decode.
const rowId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Newest first, so a HIGHER n is an OLDER row: `rowAt(0)` is the check-in that
// lands at the head mid-scroll.
const rowAt = (n: number): Row => ({
  id: rowId(n),
  created_at: new Date(Date.UTC(2026, 5, 1) - n * 86_400_000).toISOString(),
});

const makeRows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => rowAt(i + 1));

const olderThan = (row: Row, cursor: { createdAt: string; id: string }) =>
  row.created_at < cursor.createdAt ||
  (row.created_at === cursor.createdAt && row.id < cursor.id);

function toPage(rowsOut: Row[], hasMore: boolean, total: number): Page {
  const last = rowsOut[rowsOut.length - 1];
  return {
    checkIns: rowsOut,
    total,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
        : null,
  };
}

// A stand-in for GET /api/clients/[id]/check-ins over a LIVE list — `rows` is
// held by reference, so an insert at the head is visible to later pages exactly
// as a client's submission is. Answers whichever mode the key asks for, so the
// same test runs against the offset builder and the cursor one.
function makeServer(rows: Row[]) {
  return (key: string): Page => {
    const q = new URL(key, "http://test").searchParams;
    const limit = Number(q.get("limit"));

    const offsetParam = q.get("offset");
    if (offsetParam !== null) {
      const offset = Number(offsetParam);
      return toPage(
        rows.slice(offset, offset + limit),
        offset + limit < rows.length,
        rows.length
      );
    }

    // The route's own predicate: rows strictly older than the cursor, on
    // (created_at, id).
    const cursorParam = q.get("cursor");
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    const window = cursor ? rows.filter((r) => olderThan(r, cursor)) : rows;
    return toPage(window.slice(0, limit), window.length > limit, rows.length);
  };
}

type PageKeyBuilder = (index: number, previous: Page | null) => string | null;

/**
 * A minimal model of useSWRInfinite's page loop (swr 2.3.6,
 * `dist/infinite/index.mjs` — the `shouldFetchPage` expression): page n's key is
 * built from page n-1's DATA, a page whose key is already cached is served from
 * cache, and a page whose key is missing is fetched. `revalidateFirst` models
 * the first-page revalidation these readers opt into.
 */
function loadPages(
  getKey: PageKeyBuilder,
  server: (key: string) => Page,
  size: number,
  cache: Map<string, Page>,
  revalidateFirst = false
): Page[] {
  const pages: Page[] = [];
  let previous: Page | null = null;
  for (let i = 0; i < size; i++) {
    const key = getKey(i, previous);
    if (key === null) break;
    let page = cache.get(key);
    if (page === undefined || (i === 0 && revalidateFirst)) {
      page = server(key);
      cache.set(key, page);
    }
    pages.push(page);
    previous = page;
  }
  return pages;
}

/**
 * The invariant a paginated list owes its renderer: the flattened pages are ONE
 * contiguous window of the underlying list — no id twice (React's "two children
 * with the same key"), and none skipped (a row that silently vanishes). The
 * window may be STALE without being wrong; it may not be incoherent.
 */
function expectContiguousWindow(pages: Page[], rows: Row[]) {
  const ids = pages.flatMap((p) => p.checkIns).map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
  const start = rows.findIndex((r) => r.id === ids[0]);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(rows.slice(start, start + ids.length).map((r) => r.id)).toEqual(ids);
}

function unresolvedInfinite() {
  mockUseSWRInfinite.mockReturnValue({
    data: undefined,
    error: undefined,
    size: 1,
    setSize: vi.fn(),
    isLoading: true,
    mutate: vi.fn(),
  });
}

// The key builder is private to the module by design (CONVENTIONS §7 — never
// build one of these keys at a call site), so it is read off the swr mock.
function captureKeyBuilder(render: () => void): PageKeyBuilder {
  unresolvedInfinite();
  render();
  return mockUseSWRInfinite.mock.calls[0][0] as PageKeyBuilder;
}

describe("the coach check-in list pagination contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives page 2's key from page 1's cursor, and stops without one", () => {
    const getKey = captureKeyBuilder(() =>
      renderHook(() => useClientCheckInsInfinite("c1"))
    );
    const base = `/api/clients/c1/check-ins?limit=${CLIENT_CHECKINS_PAGE_SIZE}`;
    const cursor = encodeCursor({
      createdAt: "2026-05-01T00:00:00.000Z",
      id: rowId(7),
    });

    expect(getKey(0, null)).toBe(base);
    expect(
      getKey(1, { checkIns: [], nextCursor: cursor, hasMore: true })
    ).toBe(`${base}&cursor=${cursor}`);
    expect(getKey(1, { checkIns: [], nextCursor: null, hasMore: false })).toBeNull();
  });

  it("stays one contiguous window when a check-in lands before 'Load older'", () => {
    const getKey = captureKeyBuilder(() =>
      renderHook(() => useClientCheckInsInfinite("c1"))
    );
    const rows = makeRows(41);
    const server = makeServer(rows);
    const cache = new Map<string, Page>();

    // The coach has the first page on screen.
    loadPages(getKey, server, 1, cache);
    // The client submits in their own session.
    rows.unshift(rowAt(0));
    // The coach clicks "Load older".
    const pages = loadPages(getKey, server, 2, cache);

    expectContiguousWindow(pages, rows);
  });

  it("stays one contiguous window when the first page revalidates under a loaded second", () => {
    const getKey = captureKeyBuilder(() =>
      renderHook(() => useClientCheckInsInfinite("c1"))
    );
    const rows = makeRows(41);
    const server = makeServer(rows);
    const cache = new Map<string, Page>();

    // Two pages on screen.
    loadPages(getKey, server, 2, cache);
    // The client submits.
    rows.unshift(rowAt(0));
    // A focus (or a remount) revalidates the first page.
    const pages = loadPages(getKey, server, 2, cache, true);

    expectContiguousWindow(pages, rows);
  });

  it.each([
    ["useClientCheckInsInfinite", () => useClientCheckInsInfinite("c1")],
    ["useAllClientCheckIns", () => useAllClientCheckIns("c1")],
  ])("%s revalidates its first page on focus and on mount", (_name, hook) => {
    unresolvedInfinite();

    renderHook(hook);

    const config = mockUseSWRInfinite.mock.calls[0][2] as Record<string, unknown>;
    // The §7 exception `useOverdueClients` carries: the dominant writer is the
    // client submitting in another session, which no invalidator here reaches.
    expect(config.revalidateOnFocus).toBe(true);
    // Left at swr's default `true`. With it off, and focus off, these readers
    // revalidated NOTHING and only a hard reload refreshed them.
    expect(config.revalidateFirstPage).toBeUndefined();
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
    expect(filter("/api/clients/c1/check-ins?limit=20")).toBe(false);
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
    expect(area("/api/clients/c1/check-ins?limit=20")).toBe(true);
    expect(area("/api/clients/c1/check-ins?limit=20&cursor=abc")).toBe(true);
    expect(area("/api/clients/c2/check-ins?limit=20")).toBe(false);
    expect(area("/api/clients/c1/check-in-config")).toBe(false);
    expect(area("/api/clients/c1")).toBe(false);
    expect(area(undefined)).toBe(false);
  });

  it("clears the infinite page caches without refetching, and only those", async () => {
    const mutate = await invalidate("c1");

    const [pages, data, opts] = mutate.mock.calls[1] as [KeyFilter, unknown, unknown];
    expect(data).toBeUndefined();
    expect(opts).toEqual({ revalidate: false });
    expect(pages("/api/clients/c1/check-ins?limit=20")).toBe(true);
    expect(pages("/api/clients/c1/check-ins?limit=20&cursor=abc")).toBe(true);
    expect(pages("/api/clients/c2/check-ins?limit=20")).toBe(false);
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
    const page1 = getKey(1, {
      checkIns: [{ id: "x" }],
      total: 40,
      nextCursor: encodeCursor({
        createdAt: "2026-05-01T00:00:00.000Z",
        id: rowId(9),
      }),
      hasMore: true,
    });

    const mutate = await invalidate("c1");
    const pages = mutate.mock.calls[1][0] as KeyFilter;

    expect(page0).toBeTruthy();
    expect(page1).toBeTruthy();
    expect(pages(page0)).toBe(true);
    expect(pages(page1)).toBe(true);
  });
});
