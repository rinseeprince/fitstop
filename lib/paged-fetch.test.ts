import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, fetchAllByChunkedIds, chunkIds } from "./paged-fetch";

type Row = { id: number };

/** Fake table of N rows that honours (from, to) the way PostgREST .range() does. */
function fakeTable(total: number) {
  const rows: Row[] = Array.from({ length: total }, (_, i) => ({ id: i }));
  return (from: number, to: number) =>
    Promise.resolve({ data: rows.slice(from, to + 1), error: null });
}

describe("fetchAllPages", () => {
  it("returns every row past the 1000-row cap that an unpaged read would truncate at", async () => {
    // 1512 is the real global exercise-catalog size that made this bug live.
    const rows = await fetchAllPages<Row>(fakeTable(1512));
    expect(rows).toHaveLength(1512);
    expect(rows[0].id).toBe(0);
    expect(rows[1511].id).toBe(1511);
  });

  it("stops on the first short page rather than looping forever", async () => {
    const page = vi.fn(fakeTable(1500));
    await fetchAllPages<Row>(page, { pageSize: 1000 });
    // 0-999 (full) then 1000-1999 (short) -> exactly two requests.
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("makes exactly one request when the first page is already short", async () => {
    const page = vi.fn(fakeTable(10));
    const rows = await fetchAllPages<Row>(page);
    expect(rows).toHaveLength(10);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("issues a second request on an exactly-full page, so a boundary-sized set is not silently cut", async () => {
    const page = vi.fn(fakeTable(1000));
    const rows = await fetchAllPages<Row>(page, { pageSize: 1000 });
    expect(rows).toHaveLength(1000);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("throws on a page error instead of returning a partial set", async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(fetchAllPages<Row>(page, { errorLabel: "widgets" })).rejects.toThrow(
      "Failed to fetch widgets: boom",
    );
  });

  it("treats a null data page as the end", async () => {
    const page = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(fetchAllPages<Row>(page)).resolves.toEqual([]);
  });

  it("requests contiguous, non-overlapping ranges", async () => {
    const page = vi.fn(fakeTable(2500));
    await fetchAllPages<Row>(page, { pageSize: 1000 });
    expect(page.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
});

describe("chunkIds", () => {
  it("splits to the requested size and keeps every id exactly once", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids, 100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("returns no chunks for an empty list", () => {
    expect(chunkIds([], 100)).toEqual([]);
  });
});

describe("fetchAllByChunkedIds", () => {
  it("covers both ceilings at once: chunks the id list AND pages within each chunk", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => i);
    const seenChunkSizes: number[] = [];

    const rows = await fetchAllByChunkedIds<Row, number>(
      ids,
      (chunk, from, to) => {
        if (from === 0) seenChunkSizes.push(chunk.length);
        // Each chunk of 100 ids yields 1200 rows -> forces paging inside a chunk.
        return fakeTable(1200)(from, to);
      },
      { chunkSize: 100 },
    );

    expect(seenChunkSizes).toEqual([100, 100, 50]);
    expect(rows).toHaveLength(3 * 1200);
  });

  it("short-circuits on an empty id list without querying", async () => {
    const page = vi.fn();
    await expect(fetchAllByChunkedIds([], page)).resolves.toEqual([]);
    expect(page).not.toHaveBeenCalled();
  });

  it("propagates a page error", async () => {
    await expect(
      fetchAllByChunkedIds<Row, number>(
        [1, 2, 3],
        () => Promise.resolve({ data: null, error: { message: "nope" } }),
        { errorLabel: "things" },
      ),
    ).rejects.toThrow("Failed to fetch things: nope");
  });
});
