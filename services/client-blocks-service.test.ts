import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getBlockBoundForDate,
  getBlockWindowsForClients,
  listBlocks,
  replaceBlockChain,
  deleteBlock,
  setBlockArchived,
  ElapsedBlockImmutableError,
  BlockPayloadError,
  BlockWindowError,
  UnknownBlockIdError,
} from "./client-blocks-service";
import { BLOCK_EXTENSION_REFUSED } from "@/lib/constants";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "./supabase-admin";

const TODAY = "2026-08-11";
const CLIENT_ID = "client-1";

type MockResult = { data?: unknown; error: unknown };

function createMockQuery(result: MockResult) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  Object.assign(query, {
    select: vi.fn(chain),
    insert: vi.fn(chain),
    upsert: vi.fn(chain),
    update: vi.fn(chain),
    delete: vi.fn(chain),
    eq: vi.fn(chain),
    is: vi.fn(chain),
    gte: vi.fn(chain),
    lte: vi.fn(chain),
    limit: vi.fn(chain),
    order: vi.fn(chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: MockResult) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return query as Record<string, ReturnType<typeof vi.fn>> & {
    then: unknown;
  };
}

let queue: ReturnType<typeof createMockQuery>[] = [];

function queueResults(...results: MockResult[]) {
  const queries = results.map(createMockQuery);
  queue.push(...queries);
  return queries;
}

// DB-shaped rows (snake_case).
const row = (
  id: string,
  starts_on: string,
  ends_on: string,
  over: Partial<Record<string, unknown>> = {}
) => ({
  id,
  name: `Block ${id}`,
  focus: null,
  starts_on,
  ends_on,
  archived_at: null,
  ...over,
});

// Contiguous stored fixtures: E elapsed, then A current on TODAY (6 weeks).
const ELAPSED = row("e", "2026-06-01", "2026-07-05");
const CURRENT = row("a", "2026-07-06", "2026-08-16");

const elapsedEcho = { id: "e", name: "Block e" };

beforeEach(() => {
  vi.clearAllMocks();
  queue = [];
  vi.mocked(supabaseAdmin.from).mockImplementation((() => {
    const query = queue.shift();
    if (!query) throw new Error("Unexpected supabase call");
    return query;
  }) as never);
});

describe("listBlocks", () => {
  it("reads the client's chain in date order, client-scoped", async () => {
    const [query] = queueResults({ data: [ELAPSED, CURRENT], error: null });

    const blocks = await listBlocks(CLIENT_ID);

    expect(query.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(query.order).toHaveBeenCalledWith("starts_on", { ascending: true });
    expect(blocks.map((b) => b.id)).toEqual(["e", "a"]);
    // The select string is the one read tsc cannot check: a stale column name
    // there is a PostgREST 400 at runtime.
    expect(query.select).toHaveBeenCalledWith(
      "id, name, focus, starts_on, ends_on, archived_at"
    );
    expect(blocks[0]).not.toHaveProperty("targetWeightKg");
  });
});

describe("replaceBlockChain", () => {
  it("inserts a brand-new chain with computed dates and no upsert", async () => {
    const [, insertQuery] = queueResults(
      { data: [], error: null }, // stored read
      { error: null }, // insert
      { data: [], error: null } // re-read
    );

    await replaceBlockChain(CLIENT_ID, TODAY, {
      blocks: [
        { name: "Build", startsOn: "2026-08-11", endsOn: "2026-09-07" },
        { name: "Cut", startsOn: "2026-09-08", endsOn: "2026-10-19" },
      ],
    });

    expect(insertQuery.insert).toHaveBeenCalledTimes(1);
    const inserted = insertQuery.insert.mock.calls[0][0];
    expect(inserted).toEqual([
      expect.objectContaining({
        client_id: CLIENT_ID,
        name: "Build",
        starts_on: "2026-08-11",
        ends_on: "2026-09-07",
      }),
      expect.objectContaining({
        client_id: CLIENT_ID,
        name: "Cut",
        starts_on: "2026-09-08",
        ends_on: "2026-10-19",
      }),
    ]);
    for (const insertedRow of inserted) {
      expect(insertedRow).not.toHaveProperty("id");
      expect(insertedRow).not.toHaveProperty("created_at");
      expect(insertedRow).not.toHaveProperty("target_weight");
      expect(typeof insertedRow.updated_at).toBe("string");
    }
    expect(insertQuery.upsert).not.toHaveBeenCalled();
    // Invariant 7's service half: only client_phases is ever touched.
    for (const call of vi.mocked(supabaseAdmin.from).mock.calls) {
      expect(call[0]).toBe("client_phases");
    }
  });

  it("updates existing rows via upsert (full columns, no created_at) and inserts new ones", async () => {
    const [, upsertQuery, insertQuery] = queueResults(
      { data: [CURRENT], error: null },
      { error: null }, // upsert existing
      { error: null }, // insert new
      { data: [], error: null } // re-read
    );

    await replaceBlockChain(CLIENT_ID, TODAY, {
      blocks: [
        { id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-16" },
        { name: "Peak", startsOn: "2026-08-17", endsOn: "2026-08-30" },
      ],
    });

    expect(upsertQuery.upsert).toHaveBeenCalledTimes(1);
    const [upserted, options] = upsertQuery.upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: "id" });
    expect(upserted).toEqual([
      expect.objectContaining({
        id: "a",
        client_id: CLIENT_ID,
        name: "Block a",
        starts_on: "2026-07-06",
        ends_on: "2026-08-16",
      }),
    ]);
    expect(upserted[0]).not.toHaveProperty("created_at");
    expect(insertQuery.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "Peak",
        starts_on: "2026-08-17",
        ends_on: "2026-08-30",
      }),
    ]);
  });

  it("updates an elapsed block's fields in place — dates from storage (3.6-C)", async () => {
    const [, upsertQuery] = queueResults(
      { data: [ELAPSED, CURRENT], error: null },
      { error: null }, // upsert (elapsed edit + current echo)
      { data: [], error: null } // re-read
    );

    await replaceBlockChain(CLIENT_ID, TODAY, {
      blocks: [
        { id: "e", name: "Renamed", focus: "looking back" },
        { id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-16" },
      ],
    });

    const [rows] = upsertQuery.upsert.mock.calls[0];
    expect(rows).toEqual([
      expect.objectContaining({
        id: "e",
        name: "Renamed",
        focus: "looking back",
        // The pin that remains: elapsed DATES come from storage.
        starts_on: "2026-06-01",
        ends_on: "2026-07-05",
      }),
      expect.objectContaining({ id: "a", starts_on: "2026-07-06" }),
    ]);
    expect(rows[0]).not.toHaveProperty("target_weight");
  });

  it("rejects an elapsed block's date change (the pin that remains)", async () => {
    queueResults({ data: [ELAPSED, CURRENT], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { id: "e", name: "Block e", endsOn: "2026-07-06" },
          { id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-16" },
        ],
      })
    ).rejects.toBeInstanceOf(ElapsedBlockImmutableError);
  });

  it("does not rewrite an unchanged elapsed echo", async () => {
    const [, upsertQuery] = queueResults(
      { data: [ELAPSED, CURRENT], error: null },
      { error: null }, // upsert (current row only)
      { data: [], error: null } // re-read
    );

    await replaceBlockChain(CLIENT_ID, TODAY, {
      blocks: [
        { ...elapsedEcho },
        { id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-16" },
      ],
    });

    const [rows] = upsertQuery.upsert.mock.calls[0];
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["a"]);
  });

  it("rejects a chain that does not lead with the elapsed prefix", async () => {
    queueResults({ data: [ELAPSED, CURRENT], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-16" },
          { ...elapsedEcho },
        ],
      })
    ).rejects.toBeInstanceOf(ElapsedBlockImmutableError);
  });

  it("lets a block sit apart from the elapsed one before it — a gap is a real state", async () => {
    // ELAPSED ends 2026-07-05 and the current block used to have to open on the
    // 6th. It may now open later: the client was between programs and nothing
    // was planned for those days.
    queueResults(
      { data: [ELAPSED, CURRENT], error: null },
      { error: null }, // upsert
      { data: [], error: null } // re-read
    );

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { ...elapsedEcho },
          { id: "a", name: "Block a", startsOn: "2026-07-20", endsOn: "2026-08-16" },
        ],
      })
    ).resolves.toEqual([]);
  });

  it("rejects a payload that omits an existing non-elapsed block (DELETE is the removal path)", async () => {
    queueResults({ data: [ELAPSED, CURRENT], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [{ ...elapsedEcho }],
      })
    ).rejects.toBeInstanceOf(BlockPayloadError);
  });

  it("rejects an unknown block id in the payload", async () => {
    queueResults({ data: [CURRENT], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-16" },
          { id: "forged", name: "X", endsOn: "2026-08-30" },
        ],
      })
    ).rejects.toBeInstanceOf(BlockPayloadError);
  });

  it("rejects a current or future block without an end date", async () => {
    queueResults({ data: [CURRENT], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [{ id: "a", name: "Block a" }],
      })
    ).rejects.toBeInstanceOf(BlockPayloadError);
  });

  it("window floor: the current block cannot shrink below its elapsed weeks", async () => {
    queueResults({ data: [CURRENT], error: null });

    // In its final week on TODAY; ending it 2026-07-19 puts it wholly past.
    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [{ id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-07-19" }],
      })
    ).rejects.toBeInstanceOf(BlockWindowError);
  });

  it("window floor: the current block cannot be pushed to start after today", async () => {
    queueResults({ data: [CURRENT], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [{ id: "a", name: "Block a", startsOn: "2026-08-24", endsOn: "2026-09-30" }],
      })
    ).rejects.toBeInstanceOf(BlockWindowError);
  });

  it("window floor: a future block cannot be moved wholly into the past", async () => {
    const future = row("f", "2026-08-20", "2026-09-16");
    queueResults({ data: [future], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [{ id: "f", name: "Block f", startsOn: "2026-05-01", endsOn: "2026-05-28" }],
      })
    ).rejects.toBeInstanceOf(BlockWindowError);
  });

  it("refuses a CURRENT block's end moving later, with the sentence — a block is never extended", async () => {
    // More time is a NEW block after it (owner decision 2026-09-10), with its
    // own program and targets; the end of this one moves earlier or not at all.
    queueResults({ data: [CURRENT], error: null });

    const attempt = replaceBlockChain(CLIENT_ID, TODAY, {
      blocks: [{ id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-30" }],
    });

    await expect(attempt).rejects.toBeInstanceOf(BlockWindowError);
    await expect(attempt).rejects.toThrow(BLOCK_EXTENSION_REFUSED);
  });

  it("refuses a FUTURE block's end moving later too — dates-only included", async () => {
    // Not even the dates: a block that has not begun still may not grow. The
    // coach adds a block after it instead.
    const future = row("f", "2026-08-20", "2026-09-16");
    queueResults({ data: [future], error: null });

    const attempt = replaceBlockChain(CLIENT_ID, TODAY, {
      blocks: [{ id: "f", name: "Block f", startsOn: "2026-08-20", endsOn: "2026-09-30" }],
    });

    await expect(attempt).rejects.toBeInstanceOf(BlockWindowError);
    await expect(attempt).rejects.toThrow(BLOCK_EXTENSION_REFUSED);
  });

  it("still allows a current block's end moving EARLIER — the shorten", async () => {
    queueResults(
      { data: [CURRENT], error: null },
      { error: null }, // upsert
      { data: [], error: null } // re-read
    );

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        // 2026-08-12 still covers today and is earlier than the stored end.
        blocks: [{ id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-12" }],
      })
    ).resolves.toEqual([]);
  });

  it("leaves a NEW block unconstrained beside a stored one shortened — more time is a block after it", async () => {
    // The rule compares a STORED block's end with its own stored value; a row
    // without an id has nothing to be extended from, so it may run as long as
    // the coach likes.
    const future = row("f", "2026-08-20", "2026-09-16");
    queueResults(
      { data: [future], error: null },
      { error: null }, // upsert (f shortened)
      { error: null }, // insert (the new block)
      { data: [], error: null } // re-read
    );

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { id: "f", name: "Block f", startsOn: "2026-08-20", endsOn: "2026-09-09" },
          { name: "Cut", startsOn: "2026-09-10", endsOn: "2026-12-20" },
        ],
      })
    ).resolves.toEqual([]);
  });

  it("allows moving the current block's start back when it still covers today", async () => {
    queueResults(
      { data: [CURRENT], error: null },
      { error: null }, // upsert
      { data: [], error: null } // re-read
    );

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        // Anchor moved a week earlier, same end kept: the window becomes
        // 2026-06-29..2026-08-16 and still contains today — legal
        // ("we actually started earlier").
        blocks: [{ id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-16" }],
      })
    ).resolves.toEqual([]);
  });

  it("allows a future block to become current", async () => {
    const future = row("f", "2026-08-17", "2026-09-13");
    queueResults(
      { data: [future], error: null },
      { error: null }, // upsert
      { data: [], error: null } // re-read
    );

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        // 2026-08-04..2026-08-31 covers today: a stored future block may
        // become current — only wholly-past is forbidden.
        blocks: [{ id: "f", name: "Block f", startsOn: "2026-08-04", endsOn: "2026-08-31" }],
      })
    ).resolves.toEqual([]);
  });

  it("rejects an end date before the block's own start", async () => {
    queueResults({ data: [CURRENT], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-16" },
          { name: "Peak", startsOn: "2026-08-17", endsOn: "2026-08-10" },
        ],
      })
    ).rejects.toBeInstanceOf(BlockWindowError);
  });

  it("caps a block's length at BLOCK_WEEKS_MAX weeks of days", async () => {
    queueResults({ data: [], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        // 365 inclusive days — one past the 52-week ceiling.
        blocks: [{ name: "Endless", startsOn: "2026-08-11", endsOn: "2027-08-10" }],
      })
    ).rejects.toBeInstanceOf(BlockPayloadError);
  });

  it("allows a block of exactly BLOCK_WEEKS_MAX weeks", async () => {
    queueResults(
      { data: [], error: null },
      { error: null }, // insert
      { data: [], error: null } // re-read
    );

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        // 364 inclusive days = exactly 52 weeks.
        blocks: [{ name: "Year block", startsOn: "2026-08-11", endsOn: "2027-08-09" }],
      })
    ).resolves.toEqual([]);
  });

  it("refuses a block backed onto an ELAPSED one", async () => {
    // The overlap check spans the whole set, elapsed rows included. ELAPSED runs
    // to 2026-07-05; pulling the current block's start back to 2026-06-20 still
    // covers today, so only the overlap rule stops it.
    queueResults({ data: [ELAPSED, CURRENT], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { ...elapsedEcho },
          { id: "a", name: "Block a", startsOn: "2026-06-20", endsOn: "2026-08-16" },
        ],
      })
    ).rejects.toThrow('overlaps "Block e"');
  });

  it("rejects an elapsed block's START change, not only its end", async () => {
    // The write would ignore it (elapsed rows are written from storage), so
    // without this the coach is told nothing and believes the move landed.
    queueResults({ data: [ELAPSED, CURRENT], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { ...elapsedEcho, startsOn: "2026-05-04" },
          { id: "a", name: "Block a", startsOn: "2026-07-06", endsOn: "2026-08-16" },
        ],
      })
    ).rejects.toBeInstanceOf(ElapsedBlockImmutableError);
  });

  it("refuses a NEW block that opens in the past", async () => {
    // A past-dated block generates nothing — placement and the nutrition save
    // both refuse a past date — so it would be a label over days it could never
    // have prescribed. (This closes the old history-backfill affordance, which
    // no surface exposed.)
    queueResults({ data: [], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [{ name: "Old build", startsOn: "2026-06-08", endsOn: "2026-07-05" }],
      })
    ).rejects.toBeInstanceOf(BlockWindowError);
  });

  it("refuses two blocks that share a day, naming both", async () => {
    // "The block covering this date" decides the training placement window and
    // the nutrition horizon; with two answers it resolves arbitrarily.
    queueResults({ data: [], error: null });

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { name: "Build", startsOn: "2026-08-11", endsOn: "2026-09-21" },
          { name: "Peak", startsOn: "2026-09-14", endsOn: "2026-10-12" },
        ],
      })
    ).rejects.toThrow('"Peak" overlaps "Build"');
  });

  it("accepts two blocks with a gap between them", async () => {
    queueResults(
      { data: [], error: null },
      { error: null }, // insert
      { data: [], error: null } // re-read
    );

    await expect(
      replaceBlockChain(CLIENT_ID, TODAY, {
        blocks: [
          { name: "Build", startsOn: "2026-08-11", endsOn: "2026-09-07" },
          { name: "Peak", startsOn: "2026-09-28", endsOn: "2026-10-25" },
        ],
      })
    ).resolves.toEqual([]);
  });
});

describe("deleteBlock", () => {
  it("404-shape: unknown block id throws UnknownBlockIdError", async () => {
    queueResults({ data: [ELAPSED, CURRENT], error: null });

    await expect(deleteBlock(CLIENT_ID, TODAY, "nope")).rejects.toBeInstanceOf(
      UnknownBlockIdError
    );
  });

  it("refuses an elapsed block", async () => {
    queueResults({ data: [ELAPSED, CURRENT], error: null });

    await expect(deleteBlock(CLIENT_ID, TODAY, "e")).rejects.toBeInstanceOf(
      ElapsedBlockImmutableError
    );
  });

  it("removes the row and moves NOTHING else", async () => {
    // A block owns its own window, so there is no chain to re-anchor: the row
    // goes and every other block stays exactly where the coach put it. The gap
    // it leaves is a real state — nothing is planned for those days.
    const future = row("f", "2026-08-17", "2026-09-13");
    const [, deleteQuery] = queueResults(
      { data: [ELAPSED, CURRENT, future], error: null }, // stored read
      { error: null }, // delete
      { data: [ELAPSED, CURRENT], error: null } // re-read
    );

    const result = await deleteBlock(CLIENT_ID, TODAY, "f");

    expect(deleteQuery.delete).toHaveBeenCalled();
    expect(deleteQuery.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(deleteQuery.eq).toHaveBeenCalledWith("id", "f");
    // No second statement: nothing is shifted, truncated or re-anchored.
    expect(deleteQuery.upsert).not.toHaveBeenCalled();
    expect(result.blocks.map((b) => b.id)).toEqual(["e", "a"]);
  });

  it("removes the block in progress outright rather than truncating it", async () => {
    // With no chain to keep contiguous there is nothing truncation would
    // preserve; the days it covered simply belong to no block, which is the
    // same state as any other gap.
    const [, deleteQuery] = queueResults(
      { data: [ELAPSED, CURRENT], error: null },
      { error: null },
      { data: [ELAPSED], error: null }
    );

    await deleteBlock(CLIENT_ID, TODAY, "a");

    expect(deleteQuery.delete).toHaveBeenCalled();
    expect(deleteQuery.upsert).not.toHaveBeenCalled();
  });
});

describe("setBlockArchived", () => {
  it("archives an elapsed block: timestamp set, tenant-scoped, chain re-read", async () => {
    const [readQuery, updateQuery] = queueResults(
      { data: ELAPSED, error: null }, // maybeSingle read
      { error: null }, // update
      { data: [], error: null } // re-read
    );

    await setBlockArchived(CLIENT_ID, TODAY, "e", true);

    expect(readQuery.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(readQuery.eq).toHaveBeenCalledWith("id", "e");
    const [patch] = updateQuery.update.mock.calls[0];
    expect(typeof patch.archived_at).toBe("string");
    expect(typeof patch.updated_at).toBe("string");
    expect(updateQuery.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(updateQuery.eq).toHaveBeenCalledWith("id", "e");
  });

  it("restore clears the timestamp and needs no elapsed check", async () => {
    const [, updateQuery] = queueResults(
      { data: { ...ELAPSED, archived_at: "2026-08-12T00:00:00Z" }, error: null },
      { error: null },
      { data: [], error: null }
    );

    await setBlockArchived(CLIENT_ID, TODAY, "e", false);

    const [patch] = updateQuery.update.mock.calls[0];
    expect(patch.archived_at).toBeNull();
  });

  it("refuses to archive a current block — hiding live context is not decluttering", async () => {
    queueResults({ data: CURRENT, error: null });

    await expect(
      setBlockArchived(CLIENT_ID, TODAY, "a", true)
    ).rejects.toBeInstanceOf(BlockWindowError);
  });

  it("refuses to archive a future block", async () => {
    queueResults({
      data: row("f", "2026-09-01", "2026-09-28"),
      error: null,
    });

    await expect(
      setBlockArchived(CLIENT_ID, TODAY, "f", true)
    ).rejects.toBeInstanceOf(BlockWindowError);
  });

  it("404-shape: unknown block id", async () => {
    queueResults({ data: null, error: null });

    await expect(
      setBlockArchived(CLIENT_ID, TODAY, "zz", true)
    ).rejects.toBeInstanceOf(UnknownBlockIdError);
  });
});

// ===========================================================================
// getBlockBoundForDate — the ONE block-bound question, answered as covering or next.
//
// Both generators ask it: the training placement ("which bound am I inside?")
// and the nutrition horizon ("how far do I write?"). Every assertion is on the
// QUERY, because the filtering happens in Postgres — the mock returns whatever
// it is handed, so a dropped clause is only visible as a missing call.
// ===========================================================================

describe("getBlockBoundForDate", () => {
  const START = "2026-10-19";

  it("answers covering with the end of the block whose window contains the date", async () => {
    const [query] = queueResults({ data: { starts_on: "2026-10-05", ends_on: "2027-01-11" }, error: null });

    expect(await getBlockBoundForDate(CLIENT_ID, START)).toEqual({ kind: "covering", endsOn: "2027-01-11" });

    // One read for both arms: the earliest-starting block ending on or after
    // the date either contains it or is the next one, because blocks never overlap.
    expect(query.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(query.gte).toHaveBeenCalledWith("ends_on", START);
    expect(query.order).toHaveBeenCalledWith("starts_on", { ascending: true });
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it("answers next with the start of the first block after the date when none covers it", async () => {
    // A placement in a gap: the caller keeps its own fallback and caps it the
    // day before this block, so a block the coach has not set up is never filled.
    queueResults({ data: { starts_on: "2026-11-02", ends_on: "2026-11-29" }, error: null });

    expect(await getBlockBoundForDate(CLIENT_ID, START)).toEqual({ kind: "next", startsOn: "2026-11-02" });
  });

  it("answers covering for a block starting on the date itself", async () => {
    queueResults({ data: { starts_on: START, ends_on: "2026-11-15" }, error: null });

    expect(await getBlockBoundForDate(CLIENT_ID, START)).toEqual({ kind: "covering", endsOn: "2026-11-15" });
  });

  it("returns null when no block ends on or after the date", async () => {
    // Before the chain opens, or after it has run out: no bound, the callers'
    // own fallbacks apply.
    queueResults({ data: null, error: null });

    expect(await getBlockBoundForDate(CLIENT_ID, START)).toBeNull();
  });

  it("ignores an archived block", async () => {
    const [query] = queueResults({ data: null, error: null });

    await getBlockBoundForDate(CLIENT_ID, START);

    expect(query.is).toHaveBeenCalledWith("archived_at", null);
  });

  it("degrades to null on a read error rather than throwing", async () => {
    queueResults({ data: null, error: { message: "boom" } });

    await expect(getBlockBoundForDate(CLIENT_ID, START)).resolves.toBeNull();
  });
});

describe("getBlockWindowsForClients — the attention feed's cross-client read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps every non-archived block to its name and window, in one chunked read", async () => {
    const calls: Record<string, unknown[][]> = {};
    const q: Record<string, unknown> = {};
    for (const method of ["select", "in", "is", "order", "range"]) {
      q[method] = vi.fn((...args: unknown[]) => {
        (calls[method] ??= []).push(args);
        return q;
      });
    }
    Object.defineProperty(q, "then", {
      value: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        Promise.resolve({
          data: [
            { id: "b1", client_id: "c1", name: "Build", starts_on: "2026-02-02", ends_on: "2026-03-01" },
            { id: "b2", client_id: "c2", name: "Cut", starts_on: "2026-01-05", ends_on: "2026-02-01" },
          ],
          error: null,
        }).then(resolve),
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(q as never);

    expect(await getBlockWindowsForClients(["c1", "c2"])).toEqual([
      { clientId: "c1", name: "Build", start: "2026-02-02", end: "2026-03-01" },
      { clientId: "c2", name: "Cut", start: "2026-01-05", end: "2026-02-01" },
    ]);
    expect(calls.select).toEqual([["id, client_id, name, starts_on, ends_on"]]);
    expect(calls.in).toEqual([["client_id", ["c1", "c2"]]]);
    expect(calls.is).toEqual([["archived_at", null]]);
  });

  it("reads nothing for no ids", async () => {
    expect(await getBlockWindowsForClients([])).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
