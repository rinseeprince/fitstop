import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./program-event-walk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./program-event-walk")>();
  // expandProgramToWindow stays REAL — it is the thing that decides where a
  // continued pass resumes, which is what these tests are about.
  return { ...actual, generateProgramEvents: vi.fn().mockResolvedValue(0) };
});
vi.mock("./nutrition-plan-service", () => ({ getNextNutritionVersionStartCap: vi.fn() }));
vi.mock("./training-event-service", () => ({ getNextPlanStartCap: vi.fn().mockResolvedValue(null) }));
vi.mock("./event-deletion-floor", () => ({ resolveEventDeletionFloor: vi.fn() }));
vi.mock("./nutrition-plan-orchestrator", () => ({
  orchestrateNutritionPlanCreation: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { generateProgramEvents } from "./program-event-walk";
import { getNextNutritionVersionStartCap } from "./nutrition-plan-service";
import { getNextPlanStartCap } from "./training-event-service";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { orchestrateNutritionPlanCreation } from "./nutrition-plan-orchestrator";
import {
  clearEventsOutsideBlock,
  clearScheduledEvents,
  extendTrainingToBlockEnd,
  fillNutritionAcrossBlock,
  regenerateNutritionForBlock,
} from "./block-event-sync-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const TODAY = "2026-09-04";

function query<T>(result: { data: T | null; error: unknown; }) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  Object.assign(q, {
    select: vi.fn(chain), insert: vi.fn(chain), update: vi.fn(chain),
    delete: vi.fn(chain), eq: vi.fn(chain), neq: vi.fn(chain), is: vi.fn(chain),
    in: vi.fn(chain), gt: vi.fn(chain), gte: vi.fn(chain), lte: vi.fn(chain),
    or: vi.fn(chain), order: vi.fn(chain), limit: vi.fn(chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve),
  });
  return q as Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the client has not touched today, so removals may start on it.
  vi.mocked(resolveEventDeletionFloor).mockResolvedValue(TODAY);
});

describe("clearScheduledEvents", () => {
  it("removes the scheduled sessions and deactivates the slots behind them; nutrition has no day to remove", async () => {
    // The slots matter as much as the events: a plan's END is its active row
    // count, so orphans would keep the app saying it runs to the old date.
    const training = query({ data: [{ training_session_id: "s1" }], error: null });
    const slots = query({ data: null, error: null });
    let call = 0;
    mockFrom.mockImplementation((() => {
      call += 1;
      return call === 1 ? training : slots;
    }) as never);

    const result = await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-10-01", to: "2026-10-26",
    });

    expect(training.eq).toHaveBeenCalledWith("status", "scheduled");
    expect(training.gte).toHaveBeenCalledWith("date", "2026-10-01");
    expect(training.lte).toHaveBeenCalledWith("date", "2026-10-26");
    expect(slots.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false })
    );
    expect(slots.in).toHaveBeenCalledWith("id", ["s1"]);
    expect(result).toEqual({ trainingCleared: 1 });
    // A nutrition day is computed from the version covering it; the versions
    // are pulled back by the caller, and no day table is touched here.
    expect(mockFrom.mock.calls.map((call) => call[0])).toEqual([
      "training_events",
      "training_sessions",
    ]);
  });

  it("floors at the SHARED deletion floor so the past is never cleared", async () => {
    const training = query({ data: [], error: null });
    mockFrom.mockImplementation((() => training) as never);

    await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-07-13", to: "2026-10-26",
    });

    expect(resolveEventDeletionFloor).toHaveBeenCalledWith("c1", TODAY);
    expect(training.gte).toHaveBeenCalledWith("date", TODAY);
  });

  it("spares today entirely when the floor says the client has touched it", async () => {
    // Never its own arithmetic: the floor is the one answer, and a clear that
    // reached today after they logged would empty a day they are living in.
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-05");
    const training = query({ data: [], error: null });
    mockFrom.mockImplementation((() => training) as never);

    await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-08-17", to: "2026-11-09",
    });

    expect(training.gte).toHaveBeenCalledWith("date", "2026-09-05");
  });

  it("does nothing when the range has already gone by", async () => {
    const result = await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-06-01", to: "2026-08-24",
    });

    expect(result).toEqual({ trainingCleared: 0 });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("extendTrainingToBlockEnd", () => {
  /** A 3-slot program placed 5 times over: the grid stopped mid-pass. */
  const placed = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`,
    name: ["Upper", "Lower", "Rest"][i % 3],
    focus: null,
    is_rest: i % 3 === 2,
    week_index: Math.floor(i / 7),
    order_index: i % 7,
    calorie_surplus_percentage: null,
    estimated_duration_minutes: 60,
  }));

  function wire(plan: unknown, inserted: unknown[]) {
    const planQ = query({ data: plan, error: null });
    const slotQ = query({ data: placed, error: null });
    const insertQ = query({ data: inserted, error: null });
    let call = 0;
    mockFrom.mockImplementation((() => {
      call += 1;
      return call === 1 ? planQ : call === 2 ? slotQ : insertQ;
    }) as never);
    return { planQ, insertQ };
  }

  it("RESUMES the pass rather than restarting it", async () => {
    // 5 slots placed of a 3-slot program: the grid stopped two into pass two,
    // so day six is "Rest" (position 2), not "Upper". Restarting would hand the
    // client the start of the program again without being asked.
    const inserted = [{ id: "n0", week_index: 1, order_index: 0 }];
    const { insertQ } = wire(
      { id: "p1", effective_from: "2026-09-01", authored_slot_count: 3 },
      inserted
    );

    await extendTrainingToBlockEnd({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-09-01", blockEndsOn: "2026-09-06",
    });

    const rows = insertQ.insert.mock.calls[0][0] as Array<{ name: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Rest");
  });

  it("writes the block's new end onto the row BEFORE laying the events (migration 167)", async () => {
    const { insertQ } = wire(
      { id: "p1", effective_from: "2026-09-01", authored_slot_count: 3 },
      [{ id: "n0", week_index: 1, order_index: 0 }]
    );

    await extendTrainingToBlockEnd({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-09-01", blockEndsOn: "2026-09-06",
    });

    // The harness hands every call after the slot read the insert query, so
    // the row update lands on it: the end is the block's, and it is written
    // before the walk runs.
    expect(insertQ.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-09-06" })
    );
    expect(insertQ.update.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(generateProgramEvents).mock.invocationCallOrder[0]
    );
  });

  it("stops at the day before a program queued inside the block — the cap every placement takes", async () => {
    vi.mocked(getNextPlanStartCap).mockResolvedValueOnce("2026-09-04");
    const { insertQ } = wire(
      { id: "p1", effective_from: "2026-09-01", authored_slot_count: 3 },
      [{ id: "n0", week_index: 1, order_index: 0 }]
    );

    const result = await extendTrainingToBlockEnd({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-09-01", blockEndsOn: "2026-09-30",
    });

    // 5 placed days from 1 Sep reach 5 Sep already; a cap at 4 Sep leaves
    // nothing to add.
    expect(result).toBeNull();
    expect(insertQ.insert).not.toHaveBeenCalled();
    expect(getNextPlanStartCap).toHaveBeenCalledWith("c1", "2026-09-01");
  });

  it("continues the grid's coordinates so the new rows sort after every existing one", async () => {
    const { insertQ } = wire(
      { id: "p1", effective_from: "2026-09-01", authored_slot_count: 3 },
      [
        { id: "n0", week_index: 1, order_index: 0 },
        { id: "n1", week_index: 1, order_index: 1 },
      ]
    );

    await extendTrainingToBlockEnd({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-09-01", blockEndsOn: "2026-09-07",
    });

    const rows = insertQ.insert.mock.calls[0][0] as Array<{ week_index: number }>;
    // Every placed row sits at week 0; the new ones must not collide with them.
    expect(rows.every((r) => r.week_index > 0)).toBe(true);
  });

  it("lays the continuation from the deletion floor, never onto a day the client has logged", async () => {
    // The grid stopped yesterday: 5 slots from 30 Aug reach 3 Sep, and TODAY
    // is 4 Sep, so the first new day is today. The client has logged today,
    // so the floor is tomorrow, and a session laid on today would sit beside
    // the one they logged — the double-event defect the placement refuses.
    vi.mocked(resolveEventDeletionFloor).mockResolvedValueOnce("2026-09-05");
    wire(
      { id: "p1", effective_from: "2026-08-30", authored_slot_count: 3 },
      [
        { id: "n0", week_index: 1, order_index: 0 },
        { id: "n1", week_index: 1, order_index: 1 },
      ]
    );

    await extendTrainingToBlockEnd({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-08-30", blockEndsOn: "2026-09-05",
    });

    expect(resolveEventDeletionFloor).toHaveBeenCalledWith("c1", TODAY);
    expect(generateProgramEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-09-05", endDate: "2026-09-05" })
    );
  });

  it("declines a plan whose pass length was never recorded", async () => {
    // Placed before migration 165. A guessed program is worse than none, so the
    // caller tells the coach to place one.
    wire({ id: "p1", effective_from: "2026-09-01", authored_slot_count: null }, []);

    expect(
      await extendTrainingToBlockEnd({
        clientId: "c1", clientToday: TODAY,
        blockStartsOn: "2026-09-01", blockEndsOn: "2026-10-26",
      })
    ).toBeNull();
    expect(generateProgramEvents).not.toHaveBeenCalled();
  });

  it("declines when the block has no program in it at all", async () => {
    wire(null, []);

    expect(
      await extendTrainingToBlockEnd({
        clientId: "c1", clientToday: TODAY,
        blockStartsOn: "2026-09-01", blockEndsOn: "2026-10-26",
      })
    ).toBeNull();
  });

  it("declines when the grid already covers the block", async () => {
    // Nothing to add: 5 slots from 2026-09-01 already reach 2026-09-05.
    wire({ id: "p1", effective_from: "2026-09-01", authored_slot_count: 3 }, []);

    expect(
      await extendTrainingToBlockEnd({
        clientId: "c1", clientToday: TODAY,
        blockStartsOn: "2026-09-01", blockEndsOn: "2026-09-05",
      })
    ).toBeNull();
  });
});

describe("fillNutritionAcrossBlock", () => {
  /** The version laid in the block: one read, then (only if it is extended)
   *  one update. from() is called in that order. */
  function wireVersion(
    version: { id: string; effective_from: string; effective_until: string } | null
  ) {
    const readQuery = query({ data: version, error: null });
    const updateQuery = query({ data: null, error: null });
    let calls = 0;
    mockFrom.mockImplementation((() => {
      calls += 1;
      return calls === 1 ? readQuery : updateQuery;
    }) as never);
    return { readQuery, updateQuery };
  }

  beforeEach(() => {
    vi.mocked(getNextNutritionVersionStartCap).mockResolvedValue(null);
  });

  it("takes the version laid INSIDE the block and leaves one already reaching the block's end alone", async () => {
    const { readQuery, updateQuery } = wireVersion({
      id: "v1", effective_from: "2026-09-21", effective_until: "2026-12-13",
    });

    const result = await fillNutritionAcrossBlock({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-09-21", blockEndsOn: "2026-12-13",
    });

    expect(result).toEqual({ from: "2026-09-21" });
    // Laid inside the block = its start falls in the block's days; a version
    // that merely crosses the block belongs to no block and is left alone.
    expect(readQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(readQuery.gte).toHaveBeenCalledWith("effective_from", "2026-09-21");
    expect(readQuery.lte).toHaveBeenCalledWith("effective_from", "2026-12-13");
    expect(readQuery.order).toHaveBeenNthCalledWith(1, "effective_from", { ascending: false });
    // Already reaching the end: nothing to extend, and nothing else to write —
    // the days are computed from the row.
    expect(updateQuery.update).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("floors at the client's today for a block already under way", async () => {
    wireVersion({ id: "v2", effective_from: "2026-08-03", effective_until: "2026-12-13" });

    const result = await fillNutritionAcrossBlock({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-08-03", blockEndsOn: "2026-12-13",
    });

    expect(result).toEqual({ from: TODAY });
  });

  it("EXTENDS the version's stored end to the block's new end — that IS the fill (migration 166)", async () => {
    // The end is stored and the days are computed from it, so a longer block
    // has to move it or the new days answer with nothing while the block runs on.
    const { updateQuery } = wireVersion({
      id: "v3", effective_from: "2026-09-21", effective_until: "2026-11-15",
    });

    await fillNutritionAcrossBlock({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-09-21", blockEndsOn: "2026-12-13",
    });

    expect(updateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-12-13" })
    );
    expect(updateQuery.eq).toHaveBeenCalledWith("id", "v3");
    // One read, one write, nothing on a day table.
    expect(mockFrom.mock.calls.map((call) => call[0])).toEqual([
      "nutrition_plans",
      "nutrition_plans",
    ]);
  });

  it("caps the extension at the day before the next queued version — the same cap every placement takes", async () => {
    vi.mocked(getNextNutritionVersionStartCap).mockResolvedValue("2026-11-30");
    const { updateQuery } = wireVersion({
      id: "v4", effective_from: "2026-09-21", effective_until: "2026-11-15",
    });

    await fillNutritionAcrossBlock({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-09-21", blockEndsOn: "2026-12-13",
    });

    expect(getNextNutritionVersionStartCap).toHaveBeenCalledWith("c1", "2026-09-21");
    expect(updateQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-11-30" })
    );
  });

  it("does nothing when the block holds no version — the coach is told to set targets, not handed a guess", async () => {
    wireVersion(null);

    expect(
      await fillNutritionAcrossBlock({
        clientId: "c1", clientToday: TODAY,
        blockStartsOn: "2026-09-21", blockEndsOn: "2026-12-13",
      })
    ).toBeNull();
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});

describe("clearEventsOutsideBlock", () => {
  /** from() per table, in call order: the next-block probe, the last-session
   *  probe when there is no next block, the session removal, then the
   *  version cap and the version retirement on each track. */
  function wireTables(byTable: Record<string, ReturnType<typeof query>[]>) {
    mockFrom.mockImplementation(((table: string) => {
      const next = byTable[table]?.shift();
      if (!next) throw new Error(`unexpected from(${table})`);
      return next;
    }) as never);
  }

  it("pulls a version reaching past the new end back to it, and retires one starting in the cleared stretch (migration 166)", async () => {
    const capQuery = query({ data: null, error: null });
    const retireQuery = query({ data: null, error: null });
    const trainingCapQuery = query({ data: null, error: null });
    const trainingRetireQuery = query({ data: null, error: null });
    wireTables({
      client_phases: [query({ data: { starts_on: "2026-11-01" }, error: null })],
      training_events: [query({ data: [], error: null })],
      nutrition_plans: [capQuery, retireQuery],
      training_plans: [trainingCapQuery, trainingRetireQuery],
    });

    await clearEventsOutsideBlock({
      clientId: "c1", clientToday: TODAY, blockEndsOn: "2026-10-05",
    });

    // Its days are computed from its window, so pulling the end back IS
    // removing the days past it.
    expect(capQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-10-05" })
    );
    expect(capQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(capQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-05");
    expect(capQuery.gt).toHaveBeenCalledWith("effective_until", "2026-10-05");
    // A queued version now sitting in the cleared stretch goes with its days —
    // bounded by the next block, which owns its own versions.
    expect(retireQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" })
    );
    expect(retireQuery.gt).toHaveBeenCalledWith("effective_from", "2026-10-05");
    expect(retireQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-31");
    // The training programs follow their days too (migration 167): a live one
    // reaching past the new end is pulled back, a queued one in the cleared
    // stretch is archived — the same two statements, on the other track.
    expect(trainingCapQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-10-05" })
    );
    expect(trainingCapQuery.is).toHaveBeenCalledWith("deleted_at", null);
    expect(trainingCapQuery.neq).toHaveBeenCalledWith("status", "archived");
    expect(trainingCapQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-05");
    expect(trainingCapQuery.gt).toHaveBeenCalledWith("effective_until", "2026-10-05");
    expect(trainingRetireQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" })
    );
    expect(trainingRetireQuery.gt).toHaveBeenCalledWith("effective_from", "2026-10-05");
    expect(trainingRetireQuery.lte).toHaveBeenCalledWith("effective_from", "2026-10-31");
  });

  it("with nothing past the block, still pulls the versions back and retires none", async () => {
    const capQuery = query({ data: null, error: null });
    const trainingCapQuery = query({ data: null, error: null });
    wireTables({
      client_phases: [query({ data: null, error: null })],
      training_events: [query({ data: null, error: null })],
      nutrition_plans: [capQuery],
      training_plans: [trainingCapQuery],
    });

    const cleared = await clearEventsOutsideBlock({
      clientId: "c1", clientToday: TODAY, blockEndsOn: "2026-10-05",
    });

    expect(cleared).toEqual({ trainingCleared: 0 });
    expect(capQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-10-05" })
    );
    expect(trainingCapQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_until: "2026-10-05" })
    );
    // No ceiling → no session removal and no retirement: the two probes + one
    // cap per track.
    expect(mockFrom).toHaveBeenCalledTimes(4);
  });
});

describe("regenerateNutritionForBlock", () => {
  const VERSION = {
    coach_id: "coach-7",
    work_activity_level: "moderate",
    training_volume_hours: "4-6",
    protein_target_g_per_kg: 2.1,
    diet_type: "balanced",
    goal_deadline: null,
    custom_macros_enabled: false,
    custom_calories: null,
    custom_protein_g: null,
    custom_carb_g: null,
    custom_fat_g: null,
  };

  const block = (startsOn: string, endsOn: string) =>
    ({ id: "b1", name: "Cut", startsOn, endsOn, focus: null, targetWeightKg: null,
       archivedAt: null }) as never;

  it("a RUNNING block recalculates from TOMORROW, never today", async () => {
    // The client may already have eaten against today's target. Re-pricing it
    // mid-day is the one outcome a recalculation must not produce.
    const versionQuery = query({ data: VERSION, error: null });
    mockFrom.mockImplementation((() => versionQuery) as never);

    await regenerateNutritionForBlock({
      clientId: "c1", clientToday: TODAY, block: block("2026-08-10", "2026-11-16"),
    });

    expect(orchestrateNutritionPlanCreation).toHaveBeenCalledWith(
      "c1",
      "coach-7",
      expect.objectContaining({ effectiveFrom: "2026-09-05" }),
      {}
    );
    // The SETTINGS come from the ACTIVE version in force on the day it takes
    // effect — a retired version is archived, never a source (migration 166).
    expect(versionQuery.eq).toHaveBeenCalledWith("status", "active");
    expect(versionQuery.lte).toHaveBeenCalledWith("effective_from", "2026-09-05");
    expect(versionQuery.gte).toHaveBeenCalledWith("effective_until", "2026-09-05");
  });

  it("a FUTURE block recalculates as of its own start", async () => {
    const versionQuery = query({ data: VERSION, error: null });
    mockFrom.mockImplementation((() => versionQuery) as never);

    await regenerateNutritionForBlock({
      clientId: "c1", clientToday: TODAY, block: block("2026-09-28", "2026-12-21"),
    });

    expect(orchestrateNutritionPlanCreation).toHaveBeenCalledWith(
      "c1",
      "coach-7",
      expect.objectContaining({ effectiveFrom: "2026-09-28" }),
      {}
    );
  });

  it("does nothing for a block whose last day is today", async () => {
    // Tomorrow is already past its end, so there is nothing left to re-price.
    await regenerateNutritionForBlock({
      clientId: "c1", clientToday: TODAY, block: block("2026-07-27", TODAY),
    });

    expect(orchestrateNutritionPlanCreation).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("does nothing when no version is in force on the effective day", async () => {
    mockFrom.mockImplementation((() => query({ data: null, error: null })) as never);

    await regenerateNutritionForBlock({
      clientId: "c1", clientToday: TODAY, block: block("2026-08-31", "2026-10-12"),
    });

    expect(orchestrateNutritionPlanCreation).not.toHaveBeenCalled();
  });
});
