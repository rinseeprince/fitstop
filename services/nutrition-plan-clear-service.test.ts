import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));

import { supabaseAdmin } from "./supabase-admin";
import {
  clearNutritionPlanById,
  clearNutritionPlansForClient,
} from "./nutrition-plan-clear-service";

type ChainResult = { data?: unknown; error?: { message: string } | null; count?: number | null };

/**
 * Each supabaseAdmin.from() call gets its own self-returning, THENABLE chain
 * bound to the next queued result, in from()-call order: the versions read,
 * the delete of the hand edits on the days being uncovered, the cap of the
 * running versions, the archive of the queued ones. Returned for
 * per-statement assertions.
 */
function mockFromSequence(results: ChainResult[]) {
  const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  vi.mocked(supabaseAdmin.from).mockImplementation((() => {
    const result = results[chains.length] ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "in", "or", "update", "delete", "order"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
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

const running = { id: "v-run", effective_from: "2026-06-01", effective_until: "2026-08-31" };
const queued = { id: "v-queued", effective_from: "2026-07-20", effective_until: "2026-09-30" };
const startedToday = { id: "v-today", effective_from: TODAY, effective_until: "2026-08-15" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("clearNutritionPlansForClient — the calendar's own delete (no window)", () => {
  it("ends the running version at YESTERDAY, archives the queued one, and removes the hand edits on the days it uncovers", async () => {
    const chains = mockFromSequence([
      { data: [running, queued], error: null },
      { count: 2, error: null },
      { error: null },
      { error: null },
    ]);

    const result = await clearNutritionPlansForClient(CLIENT, TODAY);

    expect(result).toEqual({ versionsCleared: 2, versionIds: ["v-run", "v-queued"], editsCleared: 2 });
    // The read: only versions with a day still ahead. A finished version is
    // untouched history and is never even selected (migration 167's rule,
    // applied to both tracks).
    expect(chains[0].eq).toHaveBeenCalledWith("status", "active");
    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", TODAY);
    // The hand edits on the days being uncovered go, FIRST: the running
    // version's days from today (its past days keep their edits — they are
    // part of what the client saw) and the queued version's whole window, one
    // range each, so a day between them that a surviving version covers is
    // never touched.
    expect(chains[1].delete).toHaveBeenCalledWith({ count: "exact" });
    expect(chains[1].eq).toHaveBeenCalledWith("client_id", CLIENT);
    expect(chains[1].or).toHaveBeenCalledWith(
      "and(date.gte.2026-07-02,date.lte.2026-08-31),and(date.gte.2026-07-20,date.lte.2026-09-30)"
    );
    // The running version's window closes on yesterday: its past days keep
    // their version, on the calendar and on every block it ran in, and from
    // today nothing covers a day.
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: YESTERDAY }));
    expect(chains[2].in).toHaveBeenCalledWith("id", ["v-run"]);
    // The queued version never ran a day of its own: archived.
    expect(chains[3].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains[3].in).toHaveBeenCalledWith("id", ["v-queued"]);
    // A day's target is computed from the version covering it, so ending the
    // versions IS removing the days: the only delete is on the edits table,
    // every other statement is on the versions, and nothing reads the
    // client's logs to floor a removal.
    expect(tablesTouched()).toEqual([
      "nutrition_plans",
      "nutrition_day_edits",
      "nutrition_plans",
      "nutrition_plans",
    ]);
    for (const chain of [chains[0], chains[2], chains[3]]) expect(chain.delete).not.toHaveBeenCalled();
  });

  it("a version that started TODAY has no yesterday to end on and is archived", async () => {
    const chains = mockFromSequence([
      { data: [startedToday], error: null },
      { count: 0, error: null },
      { error: null },
    ]);

    await clearNutritionPlansForClient(CLIENT, TODAY);

    expect(chains[1].or).toHaveBeenCalledWith("and(date.gte.2026-07-02,date.lte.2026-08-15)");
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains).toHaveLength(3);
  });

  it("nothing running or queued: one read, no writes, zero", async () => {
    mockFromSequence([{ data: [], error: null }]);

    expect(await clearNutritionPlansForClient(CLIENT, TODAY)).toEqual({
      versionsCleared: 0,
      versionIds: [],
      editsCleared: 0,
    });
    expect(tablesTouched()).toEqual(["nutrition_plans"]);
  });

  it("a failed edits delete surfaces BEFORE any version moves, so a retry finds every version whole", async () => {
    mockFromSequence([{ data: [running, queued], error: null }, { error: { message: "boom" } }]);

    await expect(clearNutritionPlansForClient(CLIENT, TODAY)).rejects.toThrow(
      "Failed to remove the uncovered nutrition day edits: boom"
    );
    expect(tablesTouched()).toEqual(["nutrition_plans", "nutrition_day_edits"]);
  });

  it("a failed cap surfaces and the archive never runs", async () => {
    mockFromSequence([
      { data: [running, queued], error: null },
      { count: 0, error: null },
      { error: { message: "boom" } },
    ]);

    await expect(clearNutritionPlansForClient(CLIENT, TODAY)).rejects.toThrow(
      "Failed to end the running nutrition version: boom"
    );
    expect(tablesTouched()).toHaveLength(3);
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
  const laidInside = { id: "v-inside", effective_from: "2026-09-11", effective_until: "2026-11-05" };

  it("the residue scenario: a version whose start is inside the block is ended WHOLE, its edits from today go with it, and one whose start is outside is never selected", async () => {
    const chains = mockFromSequence([
      { data: [laidInside], error: null },
      { count: 1, error: null },
      { error: null },
    ]);

    const result = await clearNutritionPlansForClient(CLIENT, SEP_TODAY, WINDOW);

    expect(result).toEqual({ versionsCleared: 1, versionIds: ["v-inside"], editsCleared: 1 });
    // The selection is the START, bounded at both ends of the block, on top of
    // "still has a day ahead" — a version starting outside the block belongs to
    // no block and is not in the list this acts on.
    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", SEP_TODAY);
    expect(chains[0].gte).toHaveBeenCalledWith("effective_from", WINDOW.from);
    expect(chains[0].lte).toHaveBeenCalledWith("effective_from", WINDOW.to);
    // The edits go from TODAY to the version's own end — the whole tail to
    // 5 Nov, not the part inside the block, because the version answers for
    // all of it; and never 11 Sep, a day the client lived under this version.
    expect(chains[1].or).toHaveBeenCalledWith("and(date.gte.2026-09-12,date.lte.2026-11-05)");
    // The version ends at yesterday — the whole version, not the part of it
    // inside the block. Its days to 5 Nov were computed from it, so they go
    // with it; the old day delete stopped at the block's end and left 24 Sep
    // to 5 Nov standing under "no active nutrition plan".
    expect(chains[2].update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-09-11" })
    );
    expect(chains[2].in).toHaveBeenCalledWith("id", ["v-inside"]);
    expect(tablesTouched()).toEqual(["nutrition_plans", "nutrition_day_edits", "nutrition_plans"]);
  });

  it("does nothing at all for a block that holds no versions", async () => {
    mockFromSequence([{ data: [], error: null }]);

    expect(await clearNutritionPlansForClient(CLIENT, SEP_TODAY, WINDOW)).toEqual({
      versionsCleared: 0,
      versionIds: [],
      editsCleared: 0,
    });
    expect(tablesTouched()).toEqual(["nutrition_plans"]);
  });
});

// The block card's per-plan delete (C3): ONE version by id, through the same
// retire path as the two clears above — the statements are spelled once.
// Deleting a version never touches another: the running version beside it
// and the queued version after it stand, and nothing regrows.
describe("clearNutritionPlanById — the block card's per-plan delete (one version by id)", () => {
  it("a running version: proved the client's, capped at YESTERDAY, its edits from today gone — and no other version touched", async () => {
    const chains = mockFromSequence([
      { data: running, error: null },
      { count: 1, error: null },
      { error: null },
    ]);

    const result = await clearNutritionPlanById(CLIENT, TODAY, "v-run");

    expect(result).toEqual({ outcome: "ended", editsCleared: 1 });
    // The selection is the id AND the client AND active AND still ahead: a
    // foreign id, an archived version or a finished one is simply not found.
    expect(chains[0].eq).toHaveBeenCalledWith("client_id", CLIENT);
    expect(chains[0].eq).toHaveBeenCalledWith("status", "active");
    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", TODAY);
    expect(chains[0].eq).toHaveBeenCalledWith("id", "v-run");
    expect(chains[0].maybeSingle).toHaveBeenCalled();
    // The edits from today to the version's own end — never a day before today.
    expect(chains[1].or).toHaveBeenCalledWith("and(date.gte.2026-07-02,date.lte.2026-08-31)");
    // The window closes on yesterday, for this one id alone.
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: YESTERDAY }));
    expect(chains[2].in).toHaveBeenCalledWith("id", ["v-run"]);
    expect(tablesTouched()).toEqual(["nutrition_plans", "nutrition_day_edits", "nutrition_plans"]);
  });

  it("a queued version: archived, its whole window's edits gone — the running one before it stands", async () => {
    const chains = mockFromSequence([
      { data: queued, error: null },
      { count: 0, error: null },
      { error: null },
    ]);

    const result = await clearNutritionPlanById(CLIENT, TODAY, "v-queued");

    expect(result).toEqual({ outcome: "archived", editsCleared: 0 });
    expect(chains[1].or).toHaveBeenCalledWith("and(date.gte.2026-07-20,date.lte.2026-09-30)");
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains[2].in).toHaveBeenCalledWith("id", ["v-queued"]);
    // No cap statement ran: nothing else's window moved.
    expect(chains).toHaveLength(3);
  });

  it("a version that started today has no yesterday to end on and is archived", async () => {
    const chains = mockFromSequence([
      { data: startedToday, error: null },
      { count: 0, error: null },
      { error: null },
    ]);

    expect(await clearNutritionPlanById(CLIENT, TODAY, "v-today")).toEqual({
      outcome: "archived",
      editsCleared: 0,
    });
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
  });

  it("not the client's, archived, or finished: null after ONE read, and nothing moves", async () => {
    mockFromSequence([{ data: null, error: null }]);

    expect(await clearNutritionPlanById(CLIENT, TODAY, "v-someone-elses")).toBeNull();
    expect(tablesTouched()).toEqual(["nutrition_plans"]);
  });

  it("surfaces a failed read rather than reporting not found", async () => {
    mockFromSequence([{ data: null, error: { message: "boom" } }]);

    await expect(clearNutritionPlanById(CLIENT, TODAY, "v-run")).rejects.toThrow(
      "Failed to resolve the nutrition version to delete: boom"
    );
  });
});
