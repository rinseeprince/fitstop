import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The one-off fill: the copy of a check-in sent before copies existed freezes
 * exactly what its review shows now — its own rows in the log, the review's
 * as-of computation, the week's figures, today's question wording — and the
 * food rows it froze at Send when those are its week's own days. The write
 * lands only where the copy is still empty.
 */

type Call = { method: string; args: unknown[] };
type Result = { data: unknown; error: { message: string } | null };

const db = vi.hoisted(() => {
  const state = {
    chains: [] as { table: string; calls: Call[] }[],
    resolve: (_table: string, _calls: Call[]): Result => ({ data: [], error: null }),
  };
  const from = (table: string) => {
    const chain = { table, calls: [] as Call[] };
    state.chains.push(chain);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "lte", "gt", "is", "in", "order", "limit", "single", "update"]) {
      builder[method] = (...args: unknown[]) => {
        chain.calls.push({ method, args });
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(state.resolve(table, chain.calls)).then(resolve, reject);
    return builder;
  };
  return { state, from };
});

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: db.from } }));
vi.mock("./client-service", () => ({ getClientById: vi.fn() }));
vi.mock("./client-goals-service", () => ({ listClientGoals: vi.fn() }));
vi.mock("./measurements-service", () => ({
  getBaseline: vi.fn(),
  getMeasurementsForCheckIns: vi.fn(),
  getReadingsAsOf: vi.fn(),
  getReadingsOnDay: vi.fn(),
}));
vi.mock("./nutrition-plan-service", () => ({ getNutritionPlanForDate: vi.fn() }));
vi.mock("./client-adherence-service", () => ({ getClientAdherenceForRange: vi.fn() }));
vi.mock("./nutrition-period-service", () => ({ getNutritionPeriod: vi.fn() }));
vi.mock("./check-in-details-service", () => ({ resolveCheckInReportingPeriod: vi.fn() }));

import { getClientById } from "./client-service";
import { listClientGoals } from "./client-goals-service";
import { getMeasurementsForCheckIns, getReadingsAsOf, getReadingsOnDay } from "./measurements-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { getClientAdherenceForRange } from "./client-adherence-service";
import { getNutritionPeriod } from "./nutrition-period-service";
import { resolveCheckInReportingPeriod } from "./check-in-details-service";
import { buildSentSnapshotAsShown, fillSentSnapshots } from "./check-in-sent-snapshot-fill";
import type { CheckInRow } from "@/lib/database-helpers";
import type { NutritionDay } from "@/types/schedule";

const CHECK_IN = "5a1e0c0e-7777-4000-8000-000000000077";
const EARLIER = "5a1e0c0e-8888-4000-8000-000000000088";
const CLIENT_ID = "client-fill";
const Q3 = "5a1e0c0e-9999-4000-8000-000000000099";
const Q4 = "5a1e0c0e-aaaa-4000-8000-0000000000aa";
const WEEK = ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"];
const WEEKDAYS = ["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "monday"] as const;

/** A day of food against its target; `calories` tells the two sources apart. */
const food = (date: string, i: number, calories: number): NutritionDay => ({
  date,
  dayOfWeek: WEEKDAYS[i % 7],
  status: "hit",
  targetCalories: calories,
  targetProteinG: 152,
  targetCarbsG: 204,
  targetFatG: 68,
  actualCalories: calories - 12,
  actualProteinG: 150,
  actualCarbsG: 199,
  actualFatG: 69,
});
const LIVE_FOOD = WEEK.map((date, i) => food(date, i, 2230));
const SENT_FOOD = WEEK.map((date, i) => food(date, i, 2475));

const row = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    id: CHECK_IN,
    client_id: CLIENT_ID,
    status: "reviewed",
    created_at: "2026-09-14T08:40:00+00:00",
    updated_at: "2026-09-14T08:40:00+00:00",
    period_start: "2026-09-08",
    period_end: "2026-09-14",
    period_snapshot: null,
    sent_snapshot: null,
    ...overrides,
  }) as unknown as CheckInRow;

const HABITS = {
  rail: WEEK.map(() => "partial" as const),
  avgPct: 57,
  daysBelow50: 3,
  perHabit: [
    { id: "habit-sleep", name: "In bed by 11", eligibleDays: 7, completedDays: 4, pct: 57, rail: [true, false, true, false, true, false, true] },
  ],
};

describe("buildSentSnapshotAsShown — what the review shows now", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.state.chains = [];
    db.state.resolve = (table, calls) => {
      if (table === "check_in_answers") {
        return {
          data: [
            { question_id: Q3, created_at: "2026-09-14T08:40:00+00:00", check_in_questions: { prompt: "What went well?" } },
            { question_id: Q4, created_at: "2026-09-14T08:40:01+00:00", check_in_questions: null },
          ],
          error: null,
        };
      }
      if (calls.some((call) => call.method === "select" && call.args[0] === "id, created_at")) {
        return {
          data: [
            { id: CHECK_IN, created_at: "2026-09-14T08:40:00+00:00" },
            { id: EARLIER, created_at: "2026-09-07T08:40:00+00:00" },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    vi.mocked(getClientById).mockResolvedValue({
      id: CLIENT_ID,
      timezone: "Europe/London",
      startingWeight: 86.9,
      startingBodyFatPercentage: undefined,
    } as never);
    vi.mocked(getMeasurementsForCheckIns).mockImplementation((ids) => {
      const stamped = new Map<string, Record<string, number>>([
        // The check-in's own row as the log holds it now — a coach's correction included.
        [CHECK_IN, { weight: 83.1, bodyFat: 22.4, hips: 98.3 }],
        [EARLIER, { weight: 83.9 }],
      ]);
      return Promise.resolve(
        new Map([...ids].flatMap((id) => (stamped.has(id) ? [[id, stamped.get(id)!]] : [])))
      );
    });
    vi.mocked(listClientGoals).mockResolvedValue([]);
    vi.mocked(getReadingsAsOf).mockResolvedValue({
      weight: { id: "m1", metricKey: "weight", value: 83.1, date: "2026-09-14", source: "check_in" },
    });
    vi.mocked(getReadingsOnDay).mockResolvedValue({});
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(null);
    vi.mocked(resolveCheckInReportingPeriod).mockResolvedValue({ periodStart: "2026-09-08", periodEnd: "2026-09-14" });
    vi.mocked(getClientAdherenceForRange).mockResolvedValue({
      dates: WEEK,
      loggedDates: ["2026-09-09", "2026-09-14"],
      habits: HABITS,
    } as never);
    vi.mocked(getNutritionPeriod).mockResolvedValue({ days: LIVE_FOOD, summary: {} } as never);
  });

  it("its readings are its own rows in the log, as they stand now", async () => {
    const copy = await buildSentSnapshotAsShown(row());
    expect(copy.readings).toEqual({
      weight: 83.1,
      bodyFat: 22.4,
      waist: null,
      hips: 98.3,
      chest: null,
      arms: null,
      thighs: null,
    });
    expect(vi.mocked(getMeasurementsForCheckIns).mock.calls[0][0]).toEqual([CHECK_IN]);
  });

  it("judges the goal section as the review did: the as-of read WITH the check-in's id, on its day", async () => {
    await buildSentSnapshotAsShown(row());
    expect(vi.mocked(getReadingsAsOf)).toHaveBeenCalledWith(CLIENT_ID, "2026-09-14", CHECK_IN);
  });

  it("the trend is the ten check-ins up to and including it, with their rows in the log", async () => {
    await buildSentSnapshotAsShown(row());
    const trendRead = db.state.chains.find((chain) =>
      chain.calls.some((call) => call.method === "select" && call.args[0] === "id, created_at")
    )!;
    expect(trendRead.calls).toContainEqual({ method: "lte", args: ["created_at", "2026-09-14T08:40:00+00:00"] });
    expect(trendRead.calls).toContainEqual({ method: "limit", args: [10] });
    expect(vi.mocked(getMeasurementsForCheckIns)).toHaveBeenCalledWith([CHECK_IN, EARLIER]);
  });

  it("keeps each question's wording as the review shows it today", async () => {
    const copy = await buildSentSnapshotAsShown(row());
    expect(copy.questions).toEqual([
      { questionId: Q3, prompt: "What went well?" },
      { questionId: Q4, prompt: "Question" },
    ]);
  });

  it("with no food frozen at Send, the week's food is the targets the review shows now", async () => {
    const copy = await buildSentSnapshotAsShown(row());
    expect(vi.mocked(getNutritionPeriod)).toHaveBeenCalledWith(CLIENT_ID, "2026-09-08", "2026-09-14");
    expect(copy.period).toEqual({
      dates: WEEK,
      loggedDates: ["2026-09-09", "2026-09-14"],
      nutrition: LIVE_FOOD,
      habits: HABITS,
    });
  });

  it("food frozen at Send that is exactly the week's days is kept — the targets as they stood", async () => {
    const copy = await buildSentSnapshotAsShown(
      row({ period_snapshot: { generatedAt: "2026-09-14T08:40:00Z", training: [], nutrition: SENT_FOOD } })
    );
    expect(copy.period?.nutrition).toEqual(SENT_FOOD);
    expect(vi.mocked(getNutritionPeriod)).not.toHaveBeenCalled();
  });

  it("food frozen at Send for other days than the week's is not used — the copy's food and dates never disagree", async () => {
    const shifted = WEEK.slice(1).map((date, i) => food(date, i, 2475));
    const copy = await buildSentSnapshotAsShown(
      row({ period_snapshot: { generatedAt: "2026-09-14T08:40:00Z", training: [], nutrition: shifted } })
    );
    expect(copy.period?.nutrition).toEqual(LIVE_FOOD);
    expect(vi.mocked(getNutritionPeriod)).toHaveBeenCalledTimes(1);
  });

  it("a check-in whose week cannot be resolved saves no week", async () => {
    vi.mocked(resolveCheckInReportingPeriod).mockResolvedValue(null);
    const copy = await buildSentSnapshotAsShown(row({ period_start: null, period_end: null }));
    expect(copy.period).toBeNull();
    expect(vi.mocked(getNutritionPeriod)).not.toHaveBeenCalled();
  });
});

describe("fillSentSnapshots — only ever an empty copy", () => {
  const IDS = [
    "5a1e0c0e-bbbb-4000-8000-0000000000b1",
    "5a1e0c0e-bbbb-4000-8000-0000000000b2",
    "5a1e0c0e-bbbb-4000-8000-0000000000b3",
    "5a1e0c0e-bbbb-4000-8000-0000000000b4",
  ];
  /** How each check-in's write answers: filled, or matched nothing (someone else filled it). */
  let written: Record<string, boolean>;
  /** Check-ins whose row already carries a copy when the loop reads it. */
  let alreadyCopied: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    db.state.chains = [];
    written = { [IDS[0]]: true, [IDS[1]]: false, [IDS[2]]: true, [IDS[3]]: true };
    alreadyCopied = new Set([IDS[3]]);
    db.state.resolve = (table, calls) => {
      const has = (method: string) => calls.some((call) => call.method === method);
      const eqId = calls.find((call) => call.method === "eq" && call.args[0] === "id")?.args[1] as string;
      if (table === "check_in_answers") return { data: [], error: null };
      if (has("update")) return { data: written[eqId] ? [{ id: eqId }] : [], error: null };
      if (has("single")) {
        return {
          data: row({ id: eqId, sent_snapshot: alreadyCopied.has(eqId) ? { version: 1 } : null }),
          error: null,
        };
      }
      if (calls.some((call) => call.method === "select" && call.args[0] === "id, created_at")) {
        return { data: [{ id: eqId, created_at: "2026-09-14T08:40:00+00:00" }], error: null };
      }
      // The list of check-ins with no copy.
      return { data: IDS.map((id) => ({ id })), error: null };
    };
    vi.mocked(getClientById).mockImplementation(() =>
      Promise.resolve({ id: CLIENT_ID, timezone: "Europe/London", startingWeight: 86.9 } as never)
    );
    vi.mocked(getMeasurementsForCheckIns).mockResolvedValue(new Map());
    vi.mocked(listClientGoals).mockResolvedValue([]);
    vi.mocked(getReadingsAsOf).mockResolvedValue({});
    vi.mocked(getReadingsOnDay).mockResolvedValue({});
    vi.mocked(getNutritionPlanForDate).mockResolvedValue(null);
    vi.mocked(resolveCheckInReportingPeriod).mockResolvedValue(null);
  });

  it("returns at once for an empty list of clients, reading nothing", async () => {
    await expect(fillSentSnapshots({ clientIds: [] })).resolves.toEqual({
      filled: 0,
      alreadyFilled: 0,
      failed: [],
    });
    expect(db.state.chains).toEqual([]);
  });

  it("lists the check-ins with no copy by keyset, from the zero id", async () => {
    await fillSentSnapshots({ clientIds: [CLIENT_ID], concurrency: 1 });
    const list = db.state.chains.find((chain) =>
      chain.calls.some((call) => call.method === "select" && call.args[0] === "id")
    )!;
    expect(list.calls).toContainEqual({ method: "is", args: ["sent_snapshot", null] });
    expect(list.calls).toContainEqual({ method: "gt", args: ["id", "00000000-0000-0000-0000-000000000000"] });
    expect(list.calls).toContainEqual({ method: "in", args: ["client_id", [CLIENT_ID]] });
  });

  it("writes only where the copy is still empty", async () => {
    await fillSentSnapshots({ concurrency: 1 });
    const writes = db.state.chains.filter((chain) => chain.calls.some((call) => call.method === "update"));
    expect(writes).toHaveLength(3);
    for (const write of writes) {
      expect(write.calls).toContainEqual({ method: "is", args: ["sent_snapshot", null] });
    }
  });

  it("counts a copy that appeared before its write, and a write that matched nothing, as already filled", async () => {
    const result = await fillSentSnapshots({ concurrency: 1 });
    expect(result).toEqual({ filled: 2, alreadyFilled: 2, failed: [] });
  });

  it("reports a check-in that fails and carries on with the rest", async () => {
    vi.mocked(getClientById).mockImplementation(() => {
      const current = db.state.chains.at(-1)?.calls.find((call) => call.method === "eq")?.args[1];
      return Promise.resolve(
        (current === IDS[0] ? null : { id: CLIENT_ID, timezone: "Europe/London" }) as never
      );
    });

    const result = await fillSentSnapshots({ concurrency: 1 });

    expect(result.failed).toEqual([{ id: IDS[0], error: `Client ${CLIENT_ID} not found` }]);
    expect(result.filled).toBe(1);
    expect(result.alreadyFilled).toBe(2);
  });
});
