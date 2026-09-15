import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
// The one shared answer to "from which day may sessions be removed?" — its own
// rules are proved in services/event-deletion-floor.test.ts.
vi.mock("./event-deletion-floor", () => ({ resolveEventDeletionFloor: vi.fn() }));
// The statements that end a plan and remove its days are the deletes' own,
// proved in their suites; here only that the trim hands them the right rows,
// in the right order.
vi.mock("./training-event-service", () => ({ cancelFutureEventsForPlans: vi.fn() }));
vi.mock("./training-plan-clear-service", () => ({ endTrainingPlansAt: vi.fn() }));
vi.mock("./nutrition-plan-clear-service", () => ({ endNutritionVersionsAt: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { cancelFutureEventsForPlans } from "./training-event-service";
import { endTrainingPlansAt } from "./training-plan-clear-service";
import { endNutritionVersionsAt } from "./nutrition-plan-clear-service";
import { applyBlockPlanTrims, findBlockPlanTrims } from "./block-plan-trim-service";
import type { BlockPlanTrim } from "@/types/client-blocks";

type ChainResult = { data?: unknown; error?: { message: string } | null };

/** Each from() call gets its own thenable chain, bound to the next result. */
function mockFromSequence(results: ChainResult[]) {
  const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  vi.mocked(supabaseAdmin.from).mockImplementation((() => {
    const result = results[chains.length] ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "gte", "lte", "in", "update", "order", "range"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain.then = (resolve: (v: ChainResult) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    chains.push(chain as Record<string, ReturnType<typeof vi.fn>>);
    return chain;
  }) as never);
  return chains;
}

const tablesTouched = () => vi.mocked(supabaseAdmin.from).mock.calls.map((call) => call[0]);

const CLIENT = "client-7";
const TODAY = "2026-09-15";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
  vi.mocked(cancelFutureEventsForPlans).mockResolvedValue([]);
  vi.mocked(endTrainingPlansAt).mockResolvedValue({ ended: [], archived: [] });
  vi.mocked(endNutritionVersionsAt).mockResolvedValue({
    versionsCleared: 0,
    versionIds: [],
    editsCleared: 0,
  });
});

describe("findBlockPlanTrims — what a block save changes", () => {
  it("asks nothing of the database when the save draws and shortens nothing", async () => {
    expect(await findBlockPlanTrims(CLIENT, TODAY, [])).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("reads both tracks' live plans reaching the blocks, and trims them to fit", async () => {
    // Build drawn 6 Oct – 2 Nov over Strength, queued 6 Oct – 29 Nov, and its
    // targets for the same window.
    const chains = mockFromSequence([
      {
        data: [{ id: "p-1", name: "Strength", effective_from: "2026-10-06", effective_until: "2026-11-29" }],
        error: null,
      },
      { data: [{ id: "v-1", effective_from: "2026-10-06", effective_until: "2026-11-29" }], error: null },
    ]);

    const trims = await findBlockPlanTrims(CLIENT, TODAY, [
      { startsOn: "2026-10-06", endsOn: "2026-11-02", previousEndsOn: "2026-11-02" },
    ]);

    expect(trims).toEqual([
      { track: "training", id: "p-1", name: "Strength", startsOn: "2026-10-06", endsOn: "2026-11-29", newEndsOn: "2026-11-02" },
      { track: "nutrition", id: "v-1", name: null, startsOn: "2026-10-06", endsOn: "2026-11-29", newEndsOn: "2026-11-02" },
    ]);
    expect(tablesTouched()).toEqual(["training_plans", "nutrition_plans"]);
    // Scoped to the client and to live plans; reaching the block's days.
    expect(chains[0].eq).toHaveBeenCalledWith("client_id", CLIENT);
    expect(chains[0].is).toHaveBeenCalledWith("deleted_at", null);
    expect(chains[0].neq).toHaveBeenCalledWith("status", "archived");
    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", "2026-10-06");
    expect(chains[0].lte).toHaveBeenCalledWith("effective_from", "2026-11-02");
    expect(chains[1].eq).toHaveBeenCalledWith("client_id", CLIENT);
    expect(chains[1].eq).toHaveBeenCalledWith("status", "active");
    expect(chains[1].gte).toHaveBeenCalledWith("effective_until", "2026-10-06");
  });

  it("a shorten reaches back to its old end, and never reads a plan that has already finished", async () => {
    // The block in progress since 1 Sep, shortened from 25 Oct to 4 Oct.
    const chains = mockFromSequence([{ data: [], error: null }, { data: [], error: null }]);

    await findBlockPlanTrims(CLIENT, TODAY, [
      { startsOn: "2026-09-01", endsOn: "2026-10-04", previousEndsOn: "2026-10-25" },
    ]);

    expect(chains[0].gte).toHaveBeenCalledWith("effective_until", TODAY);
    expect(chains[0].lte).toHaveBeenCalledWith("effective_from", "2026-10-25");
    expect(chains[1].gte).toHaveBeenCalledWith("effective_until", TODAY);
    expect(chains[1].lte).toHaveBeenCalledWith("effective_from", "2026-10-25");
  });

  it("surfaces a failed read rather than reporting nothing to trim", async () => {
    mockFromSequence([{ data: null, error: { message: "boom" } }, { data: [], error: null }]);

    await expect(
      findBlockPlanTrims(CLIENT, TODAY, [
        { startsOn: "2026-10-06", endsOn: "2026-11-02", previousEndsOn: "2026-11-02" },
      ])
    ).rejects.toThrow("Failed to read the programs the block reaches: boom");
  });
});

const trim = (over: Partial<BlockPlanTrim>): BlockPlanTrim => ({
  track: "training",
  id: "p-1",
  name: "Power",
  startsOn: "2026-10-26",
  endsOn: "2026-12-20",
  newEndsOn: "2026-11-08",
  ...over,
});

describe("applyBlockPlanTrims — the coach said yes", () => {
  it("ends the targets first, then removes each program's later sessions and the rows behind them, then ends the programs", async () => {
    const capped = trim({});
    const removed = trim({ id: "p-2", name: "Glute", startsOn: "2026-11-09", endsOn: "2026-11-22", newEndsOn: null });
    const version = trim({ track: "nutrition", id: "v-1", name: null, newEndsOn: "2026-11-08" });
    vi.mocked(cancelFutureEventsForPlans)
      .mockResolvedValueOnce(["s-9", "s-shared"])
      .mockResolvedValueOnce(["s-10"]);
    const chains = mockFromSequence([
      // The rows still in use: the shared one, a duplicate's earlier day.
      { data: [{ training_session_id: "s-shared" }], error: null },
      { error: null },
    ]);

    await applyBlockPlanTrims(CLIENT, TODAY, [capped, removed, version]);

    expect(endNutritionVersionsAt).toHaveBeenCalledWith(CLIENT, [
      { id: "v-1", effective_from: "2026-10-26", effective_until: "2026-12-20", lastDay: "2026-11-08" },
    ]);
    // The capped program's sessions from the day after its new last day; the
    // removed one's from the floor, the way Delete plan removes one.
    expect(cancelFutureEventsForPlans).toHaveBeenNthCalledWith(1, ["p-1"], "2026-11-09");
    expect(cancelFutureEventsForPlans).toHaveBeenNthCalledWith(2, ["p-2"], TODAY);
    // The rows behind the removed sessions go, unless a remaining day uses one.
    expect(chains[0].in).toHaveBeenCalledWith("training_session_id", ["s-9", "s-shared", "s-10"]);
    expect(chains[1].update).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
    expect(chains[1].in).toHaveBeenCalledWith("id", ["s-9", "s-10"]);
    expect(chains[1].in).toHaveBeenCalledWith("plan_id", ["p-1", "p-2"]);
    expect(tablesTouched()).toEqual(["training_events", "training_sessions"]);
    expect(endTrainingPlansAt).toHaveBeenCalledWith([
      { id: "p-1", effective_from: "2026-10-26", effective_until: "2026-12-20", lastDay: "2026-11-08" },
      { id: "p-2", effective_from: "2026-11-09", effective_until: "2026-11-22", lastDay: "2026-11-08" },
    ]);
    // Windows last on each track: a failure leaves the plan still reaching
    // past its block, where the retry finds it.
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(order(endNutritionVersionsAt)).toBeLessThan(order(cancelFutureEventsForPlans));
    expect(order(cancelFutureEventsForPlans)).toBeLessThan(order(endTrainingPlansAt));
    expect(order(supabaseAdmin.from)).toBeLessThan(order(endTrainingPlansAt));
  });

  it("never removes a session before the deletion floor: a today the client trained keeps its session", async () => {
    // A block drawn from today over a running program ends it yesterday; the
    // client has logged today, so the removal starts tomorrow.
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-16");

    await applyBlockPlanTrims(CLIENT, TODAY, [
      trim({ startsOn: "2026-09-01", endsOn: "2026-10-04", newEndsOn: "2026-09-14" }),
    ]);

    expect(resolveEventDeletionFloor).toHaveBeenCalledWith(CLIENT, TODAY);
    expect(cancelFutureEventsForPlans).toHaveBeenCalledWith(["p-1"], "2026-09-16");
    // No session removed, so no row statement.
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("targets alone: no floor read and no training statement", async () => {
    await applyBlockPlanTrims(CLIENT, TODAY, [trim({ track: "nutrition", id: "v-1", name: null })]);

    expect(endNutritionVersionsAt).toHaveBeenCalledTimes(1);
    expect(resolveEventDeletionFloor).not.toHaveBeenCalled();
    expect(cancelFutureEventsForPlans).not.toHaveBeenCalled();
    expect(endTrainingPlansAt).not.toHaveBeenCalled();
  });

  it("a failed session removal stops before any program's window moves", async () => {
    vi.mocked(cancelFutureEventsForPlans).mockRejectedValueOnce(new Error("boom"));

    await expect(applyBlockPlanTrims(CLIENT, TODAY, [trim({})])).rejects.toThrow("boom");
    expect(endTrainingPlansAt).not.toHaveBeenCalled();
  });
});
