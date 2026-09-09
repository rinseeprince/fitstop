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
 * day removal, the cap of the running version, the archive of the queued ones.
 * Returned for per-statement assertions.
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
const YESTERDAY = "2026-07-01";

const running = { id: "v-run", effective_from: "2026-06-01" };
const queued = { id: "v-queued", effective_from: "2026-07-20" };
const startedToday = { id: "v-today", effective_from: TODAY };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the client has not touched today, so the floor IS their today.
  vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
});

describe("clearNutritionPlansForClient — the calendar's own delete (no window)", () => {
  it("ends the running version at YESTERDAY, archives the queued one, and clears the days from the floor", async () => {
    const chains = mockFromSequence([
      { data: [running, queued], error: null },
      { error: null },
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
    // The days: client-scoped, from the floor, scheduled only, no upper bound.
    expect(chains[1].delete).toHaveBeenCalled();
    expect(chains[1].eq).toHaveBeenCalledWith("client_id", CLIENT);
    expect(chains[1].gte).toHaveBeenCalledWith("date", TODAY);
    expect(chains[1].eq).toHaveBeenCalledWith("status", "scheduled");
    expect(chains[1].lte).not.toHaveBeenCalled();
    // The running version's window closes on yesterday: its past days keep
    // their version, on the calendar and on every block it ran in, and from
    // today nothing covers a day.
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: YESTERDAY }));
    expect(chains[2].in).toHaveBeenCalledWith("id", ["v-run"]);
    // The queued version never ran a day of its own: archived.
    expect(chains[3].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains[3].in).toHaveBeenCalledWith("id", ["v-queued"]);
  });

  it("a client who logged today keeps today's target: the day removal starts tomorrow, the version still ends YESTERDAY", async () => {
    // Yesterday, not the floor: a version closed AT a logged today kept
    // covering it and the hero went on saying "Active since" (owner, 2026-09-09).
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-07-03");
    const chains = mockFromSequence([{ data: [running], error: null }, { error: null }, { error: null }]);

    await clearNutritionPlansForClient(CLIENT, TODAY);

    expect(chains[1].gte).toHaveBeenCalledWith("date", "2026-07-03");
    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: YESTERDAY }));
  });

  it("a version that started TODAY has no yesterday to end on and is archived", async () => {
    const chains = mockFromSequence([{ data: [startedToday], error: null }, { error: null }, { error: null }]);

    await clearNutritionPlansForClient(CLIENT, TODAY);

    expect(chains[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(chains).toHaveLength(3);
  });

  it("nothing running or queued: one read, no writes, zero", async () => {
    mockFromSequence([{ data: [], error: null }]);

    expect(await clearNutritionPlansForClient(CLIENT, TODAY)).toEqual({ versionsCleared: 0, versionIds: [] });
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(1);
  });

  it("days first: a day-removal failure leaves every version whole, so a retry finds them again", async () => {
    mockFromSequence([{ data: [running], error: null }, { error: { message: "boom" } }]);

    await expect(clearNutritionPlansForClient(CLIENT, TODAY)).rejects.toThrow(
      "Failed to clear the upcoming nutrition days: boom"
    );
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(2);
  });

  it("surfaces a failed versions read rather than reporting nothing to delete", async () => {
    mockFromSequence([{ data: null, error: { message: "boom" } }]);

    await expect(clearNutritionPlansForClient(CLIENT, TODAY)).rejects.toThrow(
      "Failed to resolve the nutrition versions to clear: boom"
    );
  });
});

describe("clearNutritionPlansForClient — the block delete's 'and its plans' (a window)", () => {
  const WINDOW = { from: "2026-07-01", to: "2026-07-28" };

  it("takes only the versions LAID INSIDE the block that still have a day ahead, and bounds the day removal at both ends", async () => {
    const chains = mockFromSequence([{ data: [running], error: null }, { error: null }, { error: null }]);

    await clearNutritionPlansForClient(CLIENT, TODAY, WINDOW);

    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", TODAY);
    expect(chains[0].gte).toHaveBeenCalledWith("effective_from", WINDOW.from);
    expect(chains[0].lte).toHaveBeenCalledWith("effective_from", WINDOW.to);
    expect(chains[1].gte).toHaveBeenCalledWith("date", TODAY);
    expect(chains[1].lte).toHaveBeenCalledWith("date", WINDOW.to);
  });

  it("the floor wins over the block's start once the block is under way", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-07-10");
    const chains = mockFromSequence([{ data: [running], error: null }, { error: null }, { error: null }]);

    await clearNutritionPlansForClient(CLIENT, TODAY, WINDOW);

    expect(chains[1].gte).toHaveBeenCalledWith("date", "2026-07-10");
  });

  it("a block entirely behind the floor clears no days but still ends its versions", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-08-03");
    const chains = mockFromSequence([{ data: [running], error: null }, { error: null }]);

    await clearNutritionPlansForClient(CLIENT, TODAY, WINDOW);

    // Read, then straight to the cap: no day removal for a window the floor
    // has passed.
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(2);
    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ effective_until: YESTERDAY }));
  });

  it("does nothing at all for a block that holds no versions", async () => {
    mockFromSequence([{ data: [], error: null }]);

    expect(await clearNutritionPlansForClient(CLIENT, TODAY, WINDOW)).toEqual({
      versionsCleared: 0,
      versionIds: [],
    });
    expect(vi.mocked(supabaseAdmin.from).mock.calls).toHaveLength(1);
  });
});
