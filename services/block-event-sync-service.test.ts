import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./program-event-walk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./program-event-walk")>();
  // expandProgramToWindow stays REAL — it is the thing that decides where a
  // continued pass resumes, which is what these tests are about.
  return { ...actual, generateProgramEvents: vi.fn().mockResolvedValue(0) };
});
vi.mock("./nutrition-event-service", () => ({
  cascadeNutritionAfterTrainingChange: vi.fn(),
  regenerateFutureNutritionEvents: vi.fn(),
}));
vi.mock("./nutrition-plan-service", () => ({ getNutritionPlanIdForDate: vi.fn() }));
vi.mock("./nutrition-plan-orchestrator", () => ({
  orchestrateNutritionPlanCreation: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { generateProgramEvents } from "./program-event-walk";
import { regenerateFutureNutritionEvents } from "./nutrition-event-service";
import { getNutritionPlanIdForDate } from "./nutrition-plan-service";
import {
  clearScheduledEvents,
  extendTrainingToBlockEnd,
  fillNutritionAcrossBlock,
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

beforeEach(() => vi.clearAllMocks());

describe("clearScheduledEvents", () => {
  it("removes scheduled days on both tracks and deactivates the slots behind them", async () => {
    // The slots matter as much as the events: a plan's END is its active row
    // count, so orphans would keep the app saying it runs to the old date.
    const training = query({ data: [{ training_session_id: "s1" }], error: null });
    const slots = query({ data: null, error: null });
    const nutrition = query({ data: [{ date: "2026-10-05" }], error: null });
    let call = 0;
    mockFrom.mockImplementation((() => {
      call += 1;
      return call === 1 ? training : call === 2 ? slots : nutrition;
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
    expect(result).toEqual({ trainingCleared: 1, nutritionCleared: 1 });
  });

  it("floors at the client's today so the past is never cleared", async () => {
    const training = query({ data: [], error: null });
    const nutrition = query({ data: [], error: null });
    let call = 0;
    mockFrom.mockImplementation((() => (call += 1) === 1 ? training : nutrition) as never);

    await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-07-13", to: "2026-10-26",
    });

    expect(training.gte).toHaveBeenCalledWith("date", TODAY);
  });

  it("does nothing when the range has already gone by", async () => {
    const result = await clearScheduledEvents({
      clientId: "c1", clientToday: TODAY, from: "2026-06-01", to: "2026-08-24",
    });

    expect(result).toEqual({ trainingCleared: 0, nutritionCleared: 0 });
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
  it("regenerates from the block's start when it is still ahead", async () => {
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("v1");

    const result = await fillNutritionAcrossBlock({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-09-21", blockEndsOn: "2026-12-13",
    });

    expect(result).toEqual({ from: "2026-09-21" });
    expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith("c1", "v1", {
      kind: "from",
      from: "2026-09-21",
    });
  });

  it("floors at the client's today for a block already under way", async () => {
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("v2");

    const result = await fillNutritionAcrossBlock({
      clientId: "c1", clientToday: TODAY,
      blockStartsOn: "2026-08-03", blockEndsOn: "2026-12-13",
    });

    expect(result).toEqual({ from: TODAY });
  });

  it("does nothing when no version covers the days", async () => {
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue(null);

    expect(
      await fillNutritionAcrossBlock({
        clientId: "c1", clientToday: TODAY,
        blockStartsOn: "2026-09-21", blockEndsOn: "2026-12-13",
      })
    ).toBeNull();
    expect(regenerateFutureNutritionEvents).not.toHaveBeenCalled();
  });
});
