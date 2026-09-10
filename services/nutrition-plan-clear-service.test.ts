import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import { supabaseAdmin } from "./supabase-admin";
import { clearNutritionPlansForClient } from "./nutrition-plan-clear-service";

type ChainResult = { data?: unknown; error?: { message: string } | null };

/**
 * Each supabaseAdmin.from() call gets its own self-returning, THENABLE chain
 * bound to the next queued result, in from()-call order: the versions read,
 * the cap of the running versions, the archive of the queued ones. Returned
 * for per-statement assertions.
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

/** The tables every statement of a call touched, in order. */
const tablesTouched = () => vi.mocked(supabaseAdmin.from).mock.calls.map((call) => call[0]);

const CLIENT = "client-41";
const TODAY = "2026-07-02";
const YESTERDAY = "2026-07-01";

const running = { id: "v-run", effective_from: "2026-06-01" };
const queued = { id: "v-queued", effective_from: "2026-07-20" };
const startedToday = { id: "v-today", effective_from: TODAY };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("clearNutritionPlansForClient — the calendar's own delete (no window)", () => {
  it("ends the running version at YESTERDAY, archives the queued one, and issues no day statement", async () => {
    const chains = mockFromSequence([
      { data: [running, queued], error: null },
      { error: null },
      { error: null },
    ]);

    const result = await clearNutritionPlansForClient(CLIENT, TODAY);

    expect(result).toEqual({ versionsCleared: 2, versionIds: ["v-run", "v-queued"] });
    // The read: only versions with a day still ahead. A finished version is
    // untouched history and is never even selected (migration 167's rule,
    // applied to both tracks).
    expect(chains[0].eq).toHaveBeenCalledWith("status", "active");
    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", TODAY);
    // The running version's window closes on yesterday: its past days keep
    // their version, on the calendar and on every block it ran in, and from
    // today nothing covers a day.
    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: YESTERDAY }));
    expect(chains[1].in).toHaveBeenCalledWith("id", ["v-run"]);
    // The queued version never ran a day of its own: archived.
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains[2].in).toHaveBeenCalledWith("id", ["v-queued"]);
    // A day's target is computed from the version covering it, so ending the
    // versions IS removing the days: every statement is on the versions, none
    // on a day table, and nothing reads the client's logs to floor a removal.
    expect(tablesTouched()).toEqual(["nutrition_plans", "nutrition_plans", "nutrition_plans"]);
    for (const chain of chains) expect(chain.delete).not.toHaveBeenCalled();
  });

  it("a version that started TODAY has no yesterday to end on and is archived", async () => {
    const chains = mockFromSequence([{ data: [startedToday], error: null }, { error: null }]);

    await clearNutritionPlansForClient(CLIENT, TODAY);

    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains).toHaveLength(2);
  });

  it("nothing running or queued: one read, no writes, zero", async () => {
    mockFromSequence([{ data: [], error: null }]);

    expect(await clearNutritionPlansForClient(CLIENT, TODAY)).toEqual({ versionsCleared: 0, versionIds: [] });
    expect(tablesTouched()).toEqual(["nutrition_plans"]);
  });

  it("a failed cap surfaces and the archive never runs, so a retry finds every version whole", async () => {
    mockFromSequence([{ data: [running, queued], error: null }, { error: { message: "boom" } }]);

    await expect(clearNutritionPlansForClient(CLIENT, TODAY)).rejects.toThrow(
      "Failed to end the running nutrition version: boom"
    );
    expect(tablesTouched()).toHaveLength(2);
  });

  it("surfaces a failed versions read rather than reporting nothing to delete", async () => {
    mockFromSequence([{ data: null, error: { message: "boom" } }]);

    await expect(clearNutritionPlansForClient(CLIENT, TODAY)).rejects.toThrow(
      "Failed to resolve the nutrition versions to clear: boom"
    );
  });
});

describe("clearNutritionPlansForClient — the block delete's 'and its plans' (a window)", () => {
  // The block drawn 10–23 Sep over targets saved 11 Sep–5 Nov, the day the
  // owner found the residue: the version's START is inside the block, its end
  // is not.
  const WINDOW = { from: "2026-09-10", to: "2026-09-23" };
  const SEP_TODAY = "2026-09-12";
  const laidInside = { id: "v-inside", effective_from: "2026-09-11" };

  it("the residue scenario: a version whose start is inside the block is ended WHOLE, one whose start is outside is never selected, and no day statement is issued", async () => {
    const chains = mockFromSequence([{ data: [laidInside], error: null }, { error: null }]);

    const result = await clearNutritionPlansForClient(CLIENT, SEP_TODAY, WINDOW);

    expect(result).toEqual({ versionsCleared: 1, versionIds: ["v-inside"] });
    // The selection is the START, bounded at both ends of the block, on top of
    // "still has a day ahead" — a version starting outside the block belongs to
    // no block and is not in the list this acts on.
    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", SEP_TODAY);
    expect(chains[0].gte).toHaveBeenCalledWith("effective_from", WINDOW.from);
    expect(chains[0].lte).toHaveBeenCalledWith("effective_from", WINDOW.to);
    // The version ends at yesterday — the whole version, not the part of it
    // inside the block. Its days to 5 Nov were computed from it, so they go
    // with it; the old day delete stopped at the block's end and left 24 Sep
    // to 5 Nov standing under "no active nutrition plan".
    expect(chains[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-09-11" })
    );
    expect(chains[1].in).toHaveBeenCalledWith("id", ["v-inside"]);
    expect(tablesTouched()).toEqual(["nutrition_plans", "nutrition_plans"]);
    for (const chain of chains) expect(chain.delete).not.toHaveBeenCalled();
  });

  it("does nothing at all for a block that holds no versions", async () => {
    mockFromSequence([{ data: [], error: null }]);

    expect(await clearNutritionPlansForClient(CLIENT, SEP_TODAY, WINDOW)).toEqual({
      versionsCleared: 0,
      versionIds: [],
    });
    expect(tablesTouched()).toEqual(["nutrition_plans"]);
  });
});
