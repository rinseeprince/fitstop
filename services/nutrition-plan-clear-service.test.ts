import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./event-deletion-floor", () => ({
  // The one shared answer to "from which day may events be removed?" — its own
  // rules are proved in services/event-deletion-floor.test.ts.
  resolveEventDeletionFloor: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { clearNutritionPlansForClient } from "./nutrition-plan-clear-service";

type ChainResult = { data?: unknown; error?: { message: string } | null };

/**
 * Each supabaseAdmin.from() call gets its own self-returning, THENABLE chain
 * bound to the next queued result, in from()-call order: the versions read, the
 * day removal, the archive. Returned for per-statement assertions.
 */
function mockFromSequence(results: ChainResult[]) {
  const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  vi.mocked(supabaseAdmin.from).mockImplementation((() => {
    const result = results[chains.length] ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "in", "update", "delete", "order"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain.then = (resolve: (v: ChainResult) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    chains.push(chain as Record<string, ReturnType<typeof vi.fn>>);
    return chain;
  }) as never);
  return chains;
}

const CLIENT = "client-41";
const TODAY = "2026-07-02";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the client has not touched today, so the floor IS their today.
  vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
});

describe("clearNutritionPlansForClient — the calendar's own delete (no window)", () => {
  it("retires every ACTIVE version with days on or after the floor, and clears the days from the floor", async () => {
    const chains = mockFromSequence([
      { data: [{ id: "v41" }, { id: "v42" }], error: null },
      { error: null },
      { error: null },
    ]);

    const result = await clearNutritionPlansForClient(CLIENT, TODAY);

    expect(result).toEqual({ versionsCleared: 2, versionIds: ["v41", "v42"] });
    // The versions: active, with days on or after the floor — a finished
    // version is history and stays; the running one and the queued ones go.
    expect(chains[0].eq).toHaveBeenCalledWith("client_id", CLIENT);
    expect(chains[0].eq).toHaveBeenCalledWith("status", "active");
    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", TODAY);
    expect(chains[0].lte).not.toHaveBeenCalled();
    // The days: client-scoped from the floor, scheduled only, no upper bound,
    // edited days included (no is_modified sparing).
    expect(chains[1].delete).toHaveBeenCalled();
    expect(chains[1].eq).toHaveBeenCalledWith("client_id", CLIENT);
    expect(chains[1].gte).toHaveBeenCalledWith("date", TODAY);
    expect(chains[1].eq).toHaveBeenCalledWith("status", "scheduled");
    expect(chains[1].lte).not.toHaveBeenCalled();
    expect(chains[1].eq).not.toHaveBeenCalledWith("is_modified", expect.anything());
    // ARCHIVED, never closed at the floor and never hard-deleted.
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains[2].update).not.toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: expect.anything() })
    );
    expect(chains[2].in).toHaveBeenCalledWith("id", ["v41", "v42"]);
    expect(chains[2].delete).not.toHaveBeenCalled();
  });

  it("a client who logged today keeps today: the floor is tomorrow on both statements", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-07-03");
    const chains = mockFromSequence([{ data: [{ id: "v43" }], error: null }, { error: null }, { error: null }]);

    await clearNutritionPlansForClient(CLIENT, TODAY);

    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", "2026-07-03");
    expect(chains[1].gte).toHaveBeenCalledWith("date", "2026-07-03");
  });

  it("nothing to retire: one read, no writes, zero", async () => {
    mockFromSequence([{ data: [], error: null }]);

    expect(await clearNutritionPlansForClient(CLIENT, TODAY)).toEqual({
      versionsCleared: 0,
      versionIds: [],
    });
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(1);
  });

  it("days first: a day-removal failure leaves every version active, so a retry finds them again", async () => {
    const chains = mockFromSequence([
      { data: [{ id: "v44" }], error: null },
      { error: { message: "delete exploded" } },
    ]);

    await expect(clearNutritionPlansForClient(CLIENT, TODAY)).rejects.toThrow(/delete exploded/);
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(2);
    expect(chains[1].update).not.toHaveBeenCalled();
  });

  it("surfaces a failed versions read rather than reporting nothing to delete", async () => {
    mockFromSequence([{ data: null, error: { message: "read exploded" } }]);

    await expect(clearNutritionPlansForClient(CLIENT, TODAY)).rejects.toThrow(/read exploded/);
  });
});

describe("clearNutritionPlansForClient — the block delete's 'and its plans' (a window)", () => {
  const BLOCK = { from: "2026-07-06", to: "2026-08-02" };

  it("takes only the versions LAID INSIDE the block, and bounds the day removal at both ends", async () => {
    const chains = mockFromSequence([
      { data: [{ id: "v51" }], error: null },
      { error: null },
      { error: null },
    ]);

    const result = await clearNutritionPlansForClient(CLIENT, TODAY, BLOCK);

    expect(result).toEqual({ versionsCleared: 1, versionIds: ["v51"] });
    // Belongs to the block = its start falls in the block's days. A version
    // that merely crosses the block belongs to no block and survives.
    expect(chains[0].gte).toHaveBeenCalledWith("effective_from", "2026-07-06");
    expect(chains[0].lte).toHaveBeenCalledWith("effective_from", "2026-08-02");
    expect(chains[0].gte).not.toHaveBeenCalledWith("effective_until", expect.anything());
    // The floor is the client's today (2026-07-02), before the block, so the
    // block's own start wins at the near end; the block's last day at the far.
    expect(chains[1].gte).toHaveBeenCalledWith("date", "2026-07-06");
    expect(chains[1].lte).toHaveBeenCalledWith("date", "2026-08-02");
    expect(chains[1].eq).toHaveBeenCalledWith("status", "scheduled");
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains[2].in).toHaveBeenCalledWith("id", ["v51"]);
  });

  it("the floor wins over the block's start once the block is under way", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-07-10");
    const chains = mockFromSequence([{ data: [{ id: "v52" }], error: null }, { error: null }, { error: null }]);

    await clearNutritionPlansForClient(CLIENT, TODAY, BLOCK);

    expect(chains[1].gte).toHaveBeenCalledWith("date", "2026-07-10");
    expect(chains[1].lte).toHaveBeenCalledWith("date", "2026-08-02");
  });

  it("a block entirely behind the floor clears no days but still retires its versions", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-08-03");
    const chains = mockFromSequence([{ data: [{ id: "v53" }], error: null }, { error: null }]);

    const result = await clearNutritionPlansForClient(CLIENT, TODAY, BLOCK);

    expect(result.versionsCleared).toBe(1);
    // Two from() calls: the read and the archive — no day removal was issued.
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(2);
    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
  });

  it("does nothing at all for a block that holds no versions", async () => {
    mockFromSequence([{ data: [], error: null }]);

    expect(await clearNutritionPlansForClient(CLIENT, TODAY, BLOCK)).toEqual({
      versionsCleared: 0,
      versionIds: [],
    });
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(1);
  });
});
