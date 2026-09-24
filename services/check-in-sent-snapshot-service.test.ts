import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The copy a check-in saves at Send: every read that would have seen the
 * check-in's own readings (they are written just after its row) counts the
 * reported values instead, and the trend runs over what the check-ins before
 * it REPORTED — their saved copies, never the log.
 */

type Call = { method: string; args: unknown[] };

const db = vi.hoisted(() => {
  const state = {
    /** Rows each table answers with. */
    results: {} as Record<string, { data: unknown; error: { message: string } | null }>,
    /** Every chain issued, per table. */
    chains: [] as { table: string; calls: Call[] }[],
  };
  const from = (table: string) => {
    const chain = { table, calls: [] as Call[] };
    state.chains.push(chain);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "lte", "in", "order", "limit"]) {
      builder[method] = (...args: unknown[]) => {
        chain.calls.push({ method, args });
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(state.results[table] ?? { data: [], error: null }).then(resolve, reject);
    return builder;
  };
  return { state, from };
});

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: db.from } }));
vi.mock("./client-goals-service", () => ({ listClientGoals: vi.fn() }));
vi.mock("./measurements-service", () => ({
  getBaseline: vi.fn(),
  getReadingsAsOf: vi.fn(),
  getReadingsOnDay: vi.fn(),
}));
vi.mock("./nutrition-plan-service", () => ({ getNutritionPlanForDate: vi.fn() }));
vi.mock("./client-adherence-service", () => ({ getClientAdherenceForRange: vi.fn() }));

import { listClientGoals } from "./client-goals-service";
import { getBaseline, getReadingsAsOf, getReadingsOnDay } from "./measurements-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { getClientAdherenceForRange } from "./client-adherence-service";
import { buildSentSnapshotAtSend } from "./check-in-sent-snapshot-service";
import { parseSentSnapshot } from "@/lib/check-in/sent-snapshot";
import type { ClientGoal } from "@/types/client-goals";
import type { NutritionDay } from "@/types/schedule";

// Sent at 10:15 UTC on 21 September by a London client: their 21st.
const AT = new Date("2026-09-21T10:15:00Z");
const DAY = "2026-09-21";
const CLIENT = { id: "client-send", timezone: "Europe/London", startDate: "2026-08-03" };
const Q1 = "5a1e0c0e-4444-4000-8000-000000000044";
const Q2 = "5a1e0c0e-5555-4000-8000-000000000055";

const goalFrom = (startsOn: string): ClientGoal => ({
  id: "5a1e0c0e-6666-4000-8000-000000000066",
  clientId: "client-send",
  name: "Lose weight",
  type: "lose_weight",
  targetWeight: 76.5,
  targetBodyFatPercentage: null,
  description: null,
  startsOn,
  source: "coach",
  setBy: "coach-3",
  createdAt: `${startsOn}T08:00:00+00:00`,
  updatedAt: `${startsOn}T08:00:00+00:00`,
  deadlines: [{ effectiveOn: startsOn, deadline: "2026-11-30", setBy: "coach-3" }],
});

const reading = (metricKey: "weight" | "bodyFat", value: number, date: string) => ({
  id: `m-${metricKey}-${date}`,
  metricKey,
  value,
  date,
  source: "coach_entry" as const,
});

/** A check-in before this one, with what its own saved copy says it reported. */
const earlier = (id: string, createdAt: string, weight: number | null) => ({
  id,
  created_at: createdAt,
  sent_snapshot:
    weight === null
      ? null
      : {
          version: 1,
          day: createdAt.slice(0, 10),
          readings: { weight, bodyFat: null, waist: null, hips: null, chest: null, arms: null, thighs: null },
          standing: { weight, bodyFat: null },
          goal: null,
          goalProgress: {},
          nutritionPlan: null,
          period: null,
          questions: [],
        },
});

const WEEK = ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"];
const FOOD: NutritionDay[] = WEEK.map((date, i) => ({
  date,
  dayOfWeek: (["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "monday"] as const)[i],
  status: "no_target",
  targetCalories: null,
  targetProteinG: null,
  targetCarbsG: null,
  targetFatG: null,
  actualCalories: 1830 + i,
  actualProteinG: 141,
  actualCarbsG: 192,
  actualFatG: 63,
}));

const HABITS = {
  rail: WEEK.map(() => "complete" as const),
  avgPct: 100,
  daysBelow50: 0,
  perHabit: [
    { id: "habit-water", name: "3 L water", eligibleDays: 7, completedDays: 7, pct: 100, rail: WEEK.map(() => true) },
  ],
};

const build = (overrides: Partial<Parameters<typeof buildSentSnapshotAtSend>[0]> = {}) =>
  buildSentSnapshotAtSend({
    client: CLIENT,
    at: AT,
    day: DAY,
    reported: { weight: 79.8, waist: 84.6 },
    period: { start: "2026-09-15", end: DAY },
    nutritionDays: FOOD,
    answeredQuestionIds: [Q1, Q2],
    ...overrides,
  });

describe("buildSentSnapshotAtSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.state.chains = [];
    db.state.results = {
      check_ins: {
        data: [
          earlier("prev-1", "2026-09-14T10:00:00+00:00", 80.9),
          earlier("prev-2", "2026-09-07T10:00:00+00:00", 80.2),
        ],
        error: null,
      },
      check_in_questions: { data: [{ id: Q1, prompt: "How did training feel?" }], error: null },
    };
    vi.mocked(listClientGoals).mockResolvedValue([goalFrom("2026-09-01")]);
    vi.mocked(getReadingsAsOf).mockResolvedValue({
      weight: reading("weight", 80.4, "2026-09-19"),
      bodyFat: reading("bodyFat", 23.7, "2026-09-18"),
    });
    vi.mocked(getReadingsOnDay).mockResolvedValue({ weight: reading("weight", 81.6, "2026-09-01") });
    vi.mocked(getBaseline).mockResolvedValue({ weight: reading("weight", 84.2, "2026-08-03") });
    vi.mocked(getNutritionPlanForDate).mockResolvedValue({
      base_weight_kg: 82.35,
      effective_from: "2026-09-01",
    } as never);
    vi.mocked(getClientAdherenceForRange).mockResolvedValue({
      dates: WEEK,
      loggedDates: ["2026-09-16", "2026-09-20"],
      habits: HABITS,
    } as never);
  });

  it("the reported weight is the reading the goal is judged on; a metric not reported takes the log's as of the day", async () => {
    const copy = await build();

    expect(copy.readings).toEqual({
      weight: 79.8,
      bodyFat: null,
      waist: 84.6,
      hips: null,
      chest: null,
      arms: null,
      thighs: null,
    });
    expect(copy.standing).toEqual({ weight: 79.8, bodyFat: 23.7 });
    expect(copy.goalProgress.weight?.position?.current).toBe(79.8);
  });

  it("reads the log as of the check-in's day WITHOUT a check-in id — its own rows are not written yet", async () => {
    await build();
    expect(vi.mocked(getReadingsAsOf).mock.calls).toEqual([["client-send", DAY]]);
  });

  it("a goal started earlier runs from the log's reading on its start day", async () => {
    const copy = await build();
    expect(vi.mocked(getReadingsOnDay)).toHaveBeenCalledWith("client-send", "2026-09-01");
    expect(copy.goalProgress.weight?.goalStartWeight).toBe(81.6);
  });

  it("a goal starting today runs from the weight reported today — the reading written last that day", async () => {
    vi.mocked(listClientGoals).mockResolvedValue([goalFrom(DAY)]);
    vi.mocked(getReadingsOnDay).mockResolvedValue({ weight: reading("weight", 80.1, "2026-09-20") });

    const copy = await build();

    expect(copy.goalProgress.weight?.goalStartWeight).toBe(79.8);
  });

  it("the baseline counts the reported weight only when the start date is on or after the check-in's day", async () => {
    const before = await build();
    expect(before.goalProgress.weight?.startingWeight).toBe(84.2);

    const after = await build({ client: { ...CLIENT, startDate: "2026-09-24" } });
    expect(after.goalProgress.weight?.startingWeight).toBe(79.8);
  });

  it("without a start date there is no baseline, and the reading then stands in", async () => {
    const copy = await build({ client: { ...CLIENT, startDate: undefined } });
    expect(copy.goalProgress.weight?.startingWeight).toBe(79.8);
  });

  it("the trend puts this check-in first and reads the nine before it from what they reported", async () => {
    // Before it: 80.2 then 80.9 — gaining, against a loss goal. This check-in's
    // 79.8 at the head of the trend turns it into a loss.
    const copy = await build();
    expect(copy.goalProgress.weight?.position?.trend).toBe("towards");

    const trendRead = db.state.chains.find((chain) => chain.table === "check_ins")!;
    expect(trendRead.calls).toContainEqual({ method: "lte", args: ["created_at", AT.toISOString()] });
    expect(trendRead.calls).toContainEqual({ method: "limit", args: [9] });
    expect(trendRead.calls).toContainEqual({ method: "select", args: ["id, created_at, sent_snapshot"] });
  });

  it("a trend over reports: the earlier check-ins' saved weights decide it", async () => {
    // Reported 81.9 after 80.2 and 80.9: gaining against a loss goal.
    const copy = await build({ reported: { weight: 81.9 } });
    expect(copy.goalProgress.weight?.position?.trend).toBe("away");
  });

  it("a first check-in has no trend, and saves none — never a guess (commit 8d4)", async () => {
    db.state.results.check_ins = { data: [], error: null };
    const copy = await build({ reported: { weight: 78.3 } });
    expect(copy.version).toBe(2);
    expect(copy.goalProgress.weight?.position?.trend).toBeNull();
  });

  it("refuses to freeze a trend with a hole in it — an earlier check-in without a saved copy throws", async () => {
    db.state.results.check_ins = {
      data: [earlier("prev-unfilled", "2026-09-14T10:00:00+00:00", null)],
      error: null,
    };
    await expect(build()).rejects.toThrow(/prev-unfilled has no saved copy/);
  });

  it("freezes the week — the days, the days logged, the food rows and the habits", async () => {
    const copy = await build();
    expect(vi.mocked(getClientAdherenceForRange)).toHaveBeenCalledWith("client-send", "2026-09-15", DAY, DAY);
    expect(copy.period).toEqual({
      dates: WEEK,
      loggedDates: ["2026-09-16", "2026-09-20"],
      nutrition: FOOD,
      habits: HABITS,
    });
  });

  it("with no week to report on, freezes none and reads no figures", async () => {
    const copy = await build({ period: null, nutritionDays: null });
    expect(copy.period).toBeNull();
    expect(vi.mocked(getClientAdherenceForRange)).not.toHaveBeenCalled();
  });

  it("keeps the wording of each question the client answered", async () => {
    const copy = await build();
    expect(copy.questions).toEqual([
      { questionId: Q1, prompt: "How did training feel?" },
      { questionId: Q2, prompt: "Question" },
    ]);
  });

  it("freezes the nutrition plan the drift note compares with, and the goal as it stood", async () => {
    const copy = await build();
    expect(copy.nutritionPlan).toEqual({ baseWeightKg: 82.35, effectiveFrom: "2026-09-01" });
    expect(copy.goal).toMatchObject({ targetWeight: 76.5, startsOn: "2026-09-01", deadline: "2026-11-30" });
    expect(copy.day).toBe(DAY);
  });

  it("returns a copy that passes its own declared shape", async () => {
    const copy = await build();
    expect(parseSentSnapshot(copy)).toEqual(copy);
  });
});
