import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CheckIn, CheckInTrainingEventDetail } from "@/types/check-in";

// Mock the spine reader + the legacy-fallback dependencies. These let us assert
// that the read uses the STORED period, never a today-relative window.
const getTrainingEventDetailsForPeriodMock = vi.fn();
const getClientByIdMock = vi.fn();
const calculateCheckInPeriodMock = vi.fn();

vi.mock("./check-in-context-service", () => ({
  getTrainingEventDetailsForPeriod: (...args: unknown[]) =>
    getTrainingEventDetailsForPeriodMock(...args),
}));

vi.mock("./client-service", () => ({
  getClientById: (...args: unknown[]) => getClientByIdMock(...args),
}));

vi.mock("@/lib/date-helpers", () => ({
  calculateCheckInPeriod: (...args: unknown[]) => calculateCheckInPeriodMock(...args),
}));

// Not exercised here but imported transitively.
vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./check-in-service", () => ({ getCheckInById: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { parseSentSnapshot, type SentSnapshot } from "@/lib/check-in/sent-snapshot";
import type { NutritionDay } from "@/types/schedule";
import {
  getTrainingEventDetailsForCheckIn,
  getCheckInAnswers,
  getCheckInPeriodAdherence,
  insertCheckInAnswers,
  resolveCheckInReportingPeriod,
  mapExerciseHighlight,
} from "./check-in-details-service";

const baseCheckIn = (overrides: Partial<CheckIn> = {}): CheckIn => ({
  id: "ci-1",
  clientId: "client-1",
  status: "pending",
  periodStart: "2026-05-08",
  periodEnd: "2026-05-14",
  createdAt: "2026-05-14T12:00:00Z",
  updatedAt: "2026-05-14T12:00:00Z",
  ...overrides,
});

const detail = (overrides: Partial<CheckInTrainingEventDetail>): CheckInTrainingEventDetail => ({
  eventId: "e-1",
  date: "2026-05-08", // a Friday
  sessionName: "Push Day",
  status: "scheduled",
  logStatus: "not_logged",
  completionQuality: null,
  trainingSessionId: "ts-1",
  sessionLogId: null,
  ...overrides,
});

describe("getTrainingEventDetailsForCheckIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the STORED period window and hands back the period's own workouts", async () => {
    const workouts = [
      detail({
        eventId: "e-1",
        date: "2026-05-11",
        sessionName: "Push Day",
        status: "completed",
        logStatus: "logged",
        completionQuality: "full",
        notes: "felt strong",
        sessionLogId: "log-1",
      }),
      detail({
        eventId: "e-2",
        date: "2026-05-13",
        sessionName: "Pull Day",
        status: "scheduled",
        logStatus: "not_logged",
      }),
    ];
    getTrainingEventDetailsForPeriodMock.mockResolvedValue(workouts);

    const result = await getTrainingEventDetailsForCheckIn(baseCheckIn());

    // Window comes from the STORED period — NOT a today-relative recompute.
    expect(getTrainingEventDetailsForPeriodMock).toHaveBeenCalledWith(
      "client-1",
      "2026-05-08",
      "2026-05-14"
    );
    expect(calculateCheckInPeriodMock).not.toHaveBeenCalled();
    expect(getClientByIdMock).not.toHaveBeenCalled();

    // Handed back as they are: no second per-check-in shape to keep in step
    // with the one the wizard already receives.
    expect(result).toBe(workouts);
  });

  it("legacy pre-038 rows (null stored period) fall back to the check-in's OWN createdAt date, never today", async () => {
    getClientByIdMock.mockResolvedValue({ nextCheckInDue: "2026-06-14" }); // a Sunday
    calculateCheckInPeriodMock.mockReturnValue({
      periodStart: "2025-01-05",
      periodEnd: "2025-01-11",
    });
    getTrainingEventDetailsForPeriodMock.mockResolvedValue([]);

    const legacy = baseCheckIn({
      periodStart: undefined,
      periodEnd: undefined,
      createdAt: "2025-01-11T12:00:00Z",
    });
    await getTrainingEventDetailsForCheckIn(legacy);

    // The period is computed from the check-in's createdAt date — not a fresh
    // `new Date()` "today" window.
    const [dateArg] = calculateCheckInPeriodMock.mock.calls[0];
    expect((dateArg as Date).toISOString()).toBe("2025-01-11T12:00:00.000Z");
    expect(getTrainingEventDetailsForPeriodMock).toHaveBeenCalledWith(
      "client-1",
      "2025-01-05",
      "2025-01-11"
    );
  });

  it("returns nothing when the period cannot be resolved at all", async () => {
    getClientByIdMock.mockResolvedValue({ nextCheckInDue: null });

    const result = await getTrainingEventDetailsForCheckIn(
      baseCheckIn({ periodStart: undefined, periodEnd: undefined })
    );

    expect(result).toEqual([]);
    expect(getTrainingEventDetailsForPeriodMock).not.toHaveBeenCalled();
  });
});

// No test covered this mapper before, which is how 0c4cebf shipped: the client
// check-in route served raw snake_case rows, the page was rewritten to read
// camelCase, and nothing failed. The field names ARE the contract here.
describe("mapExerciseHighlight", () => {
  it("converts a raw row to the camelCase domain shape", () => {
    const mapped = mapExerciseHighlight({
      id: "h-1",
      check_in_id: "ci-1",
      exercise_id: "ex-1",
      exercise_name: "Back Squat",
      highlight_type: "pr",
      details: "felt strong",
      weight_value: 102.5,
      reps: 3,
    } as never);

    expect(mapped).toMatchObject({
      id: "h-1",
      checkInId: "ci-1",
      exerciseId: "ex-1",
      exerciseName: "Back Squat",
      highlightType: "pr",
      details: "felt strong",
      weightValue: 102.5,
      reps: 3,
    });
    expect(mapped).not.toHaveProperty("exercise_name");
    expect(mapped).not.toHaveProperty("weight_value");
  });

  it("maps absent optional columns to undefined rather than null", () => {
    const mapped = mapExerciseHighlight({
      id: "h-2",
      check_in_id: "ci-1",
      exercise_id: null,
      exercise_name: "Bench Press",
      highlight_type: "note",
      details: null,
      weight_value: null,
      reps: null,
    } as never);

    expect(mapped.exerciseId).toBeUndefined();
    expect(mapped.details).toBeUndefined();
    expect(mapped.weightValue).toBeUndefined();
    expect(mapped.reps).toBeUndefined();
    expect(mapped.exerciseName).toBe("Bench Press");
  });
});

describe("resolveCheckInReportingPeriod", () => {
  beforeEach(() => {
    getClientByIdMock.mockReset();
    calculateCheckInPeriodMock.mockReset();
  });

  const legacy = {
    id: "ci-legacy",
    clientId: "c1",
    createdAt: "2026-05-14T12:00:00Z",
    periodStart: null,
    periodEnd: null,
  } as unknown as CheckIn;

  it("prefers the STORED period and asks the client service nothing", async () => {
    const stored = {
      id: "ci-1",
      clientId: "c1",
      createdAt: "2026-05-14T12:00:00Z",
      periodStart: "2026-05-08",
      periodEnd: "2026-05-14",
    } as unknown as CheckIn;

    expect(await resolveCheckInReportingPeriod(stored)).toEqual({
      periodStart: "2026-05-08",
      periodEnd: "2026-05-14",
    });
    expect(getClientByIdMock).not.toHaveBeenCalled();
  });

  it("recomputes a legacy row's window from its OWN createdAt, never today", async () => {
    getClientByIdMock.mockResolvedValue({ nextCheckInDue: "2026-05-14" });
    calculateCheckInPeriodMock.mockReturnValue({
      periodStart: "2026-05-08",
      periodEnd: "2026-05-14",
    });

    await resolveCheckInReportingPeriod(legacy);

    const [dateArg] = calculateCheckInPeriodMock.mock.calls[0];
    expect((dateArg as Date).toISOString()).toBe("2026-05-14T12:00:00.000Z");
  });

  it("is null when a legacy row's client has no schedule to anchor a week to", async () => {
    getClientByIdMock.mockResolvedValue({ nextCheckInDue: null });

    expect(await resolveCheckInReportingPeriod(legacy)).toBeNull();
  });
});

/** A check-in's saved copy (lib/check-in/sent-snapshot.ts), with a week or without. */
function sentCopy(overrides: Partial<SentSnapshot> = {}): SentSnapshot {
  return parseSentSnapshot({
    version: 1,
    day: "2026-05-14",
    readings: { weight: 81.7, bodyFat: null, waist: null, hips: null, chest: null, arms: null, thighs: null },
    standing: { weight: 81.7, bodyFat: null },
    goal: null,
    goalProgress: {},
    nutritionPlan: null,
    period: null,
    questions: [],
    ...overrides,
  });
}

const foodDay = (
  date: string,
  status: NutritionDay["status"],
  target: number | null,
  eaten: number | null
): NutritionDay => ({
  date,
  dayOfWeek: "friday",
  status,
  targetCalories: target,
  targetProteinG: target == null ? null : 140,
  targetCarbsG: target == null ? null : 210,
  targetFatG: target == null ? null : 65,
  actualCalories: eaten,
  actualProteinG: eaten == null ? null : 140,
  actualCarbsG: eaten == null ? null : 210,
  actualFatG: eaten == null ? null : 65,
});

describe("getCheckInPeriodAdherence — the week as it stood when the check-in was sent", () => {
  const habits = {
    rail: ["complete", "no_log", "none"] as ("complete" | "no_log" | "none")[],
    avgPct: 50,
    daysBelow50: 1,
    perHabit: [
      { id: "h-1", name: "10k steps", eligibleDays: 2, completedDays: 1, pct: 50, rail: [true, false, null] },
    ],
  };
  const week: SentSnapshot["period"] = {
    dates: ["2026-05-12", "2026-05-13", "2026-05-14"],
    loggedDates: ["2026-05-12", "2026-05-14"],
    nutrition: [
      foodDay("2026-05-12", "hit", 2050, 2050),
      foodDay("2026-05-13", "not_logged", 2050, null),
      foodDay("2026-05-14", "no_target", null, 1930),
    ],
    habits,
  };

  beforeEach(() => vi.clearAllMocks());

  it("reads the copy's week — the food rows through the Overview's rules, the habits and the days verbatim — and nothing live", () => {
    const result = getCheckInPeriodAdherence({ id: "ci-11", sentSnapshot: sentCopy({ period: week }) });

    expect(result?.dates).toEqual(week.dates);
    expect(result?.loggedDates).toEqual(week.loggedDates);
    expect(result?.habits).toEqual(habits);
    // One dot per day from its frozen standing: hit, a targeted day not logged, no target.
    expect(result?.nutrition.rail).toEqual(["complete", "no_log", "none"]);
    // The kernel over the frozen rows: two targeted days, one on target; the
    // untargeted day is logged and in no ratio.
    expect(result?.nutrition).toMatchObject({
      periodDays: 3,
      loggedDays: 2,
      targetedDays: 2,
      onTarget: 1,
      loggedNoTargetDays: 1,
      daysOnTargetPct: 50,
    });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(getClientByIdMock).not.toHaveBeenCalled();
  });

  it("does NOT carry training — the page derives its own, differently", () => {
    const result = getCheckInPeriodAdherence({ id: "ci-12", sentSnapshot: sentCopy({ period: week }) });
    expect(Object.keys(result ?? {}).sort()).toEqual(["dates", "habits", "loggedDates", "nutrition"]);
    expect(result).not.toHaveProperty("training");
  });

  it("is null, and reads nothing, when the copy saved no week — the period could not be resolved", () => {
    const result = getCheckInPeriodAdherence({ id: "ci-13", sentSnapshot: sentCopy({ period: null }) });

    expect(result).toBeNull();
    expect(getClientByIdMock).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("throws for a check-in with no saved copy rather than computing today's figures", () => {
    expect(() => getCheckInPeriodAdherence({ id: "ci-14", sentSnapshot: null })).toThrow(/no saved copy/);
  });
});

describe("getCheckInAnswers — each answer under the wording the client saw", () => {
  /** A `check_in_answers` builder whose `.order()` resolves. */
  function wire(rows: unknown, error: unknown = null) {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.order = vi.fn().mockResolvedValue({ data: rows, error });
    vi.mocked(supabaseAdmin.from).mockReturnValue(builder as never);
    return builder;
  }

  const copy = sentCopy({
    questions: [
      { questionId: "00000000-0000-4000-8000-00000000a0a1", prompt: "How was sleep?" },
      { questionId: "00000000-0000-4000-8000-00000000a0a2", prompt: "Any pain this week?" },
    ],
  });

  beforeEach(() => vi.clearAllMocks());

  it("labels each answer with the wording its copy saved — a question reworded since never relabels it", () => {
    const builder = wire([
      { question_id: "00000000-0000-4000-8000-00000000a0a1", answer: "slept badly", created_at: "2026-05-14T12:00:01Z" },
      { question_id: "00000000-0000-4000-8000-00000000a0a2", answer: "left knee", created_at: "2026-05-14T12:00:02Z" },
    ]);

    return expect(getCheckInAnswers({ id: "ci-21", sentSnapshot: copy }))
      .resolves.toEqual([
        { questionId: "00000000-0000-4000-8000-00000000a0a1", answer: "slept badly", prompt: "How was sleep?" },
        { questionId: "00000000-0000-4000-8000-00000000a0a2", answer: "left knee", prompt: "Any pain this week?" },
      ])
      .then(() => {
        // The answers only — the question's live wording is never joined.
        expect(builder.select).toHaveBeenCalledWith("question_id, answer, created_at");
      });
  });

  it("falls back to a neutral label for an answer whose question the copy does not name", async () => {
    wire([{ question_id: "00000000-0000-4000-8000-00000000a0a9", answer: "fine", created_at: "2026-05-14T12:00:03Z" }]);
    await expect(getCheckInAnswers({ id: "ci-22", sentSnapshot: copy })).resolves.toEqual([
      { questionId: "00000000-0000-4000-8000-00000000a0a9", answer: "fine", prompt: "Question" },
    ]);
  });

  it("scopes to the check-in and orders oldest first, so answers read in form order", async () => {
    const builder = wire([]);
    await getCheckInAnswers({ id: "ci-23", sentSnapshot: copy });

    expect(builder.eq).toHaveBeenCalledWith("check_in_id", "ci-23");
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: true });
  });

  it("degrades to an empty list on a read error rather than failing the whole detail", async () => {
    wire(null, { message: "boom" });
    await expect(getCheckInAnswers({ id: "ci-24", sentSnapshot: copy })).resolves.toEqual([]);
  });

  it("throws for a check-in with no saved copy rather than labelling answers with today's wording", async () => {
    await expect(getCheckInAnswers({ id: "ci-25", sentSnapshot: null })).rejects.toThrow(/no saved copy/);
  });
});

describe("insertCheckInAnswers", () => {
  function wireInsert(error: unknown = null) {
    const builder = { insert: vi.fn().mockResolvedValue({ error }) };
    vi.mocked(supabaseAdmin.from).mockReturnValue(builder as never);
    return builder;
  }

  beforeEach(() => vi.clearAllMocks());

  it("writes one row per answer in a single INSERT", async () => {
    const builder = wireInsert();

    await insertCheckInAnswers("ci-1", [
      { questionId: "q-a", answer: "yes" },
      { questionId: "q-b", answer: "no" },
    ]);

    expect(builder.insert).toHaveBeenCalledTimes(1);
    expect(builder.insert).toHaveBeenCalledWith([
      { check_in_id: "ci-1", question_id: "q-a", answer: "yes" },
      { check_in_id: "ci-1", question_id: "q-b", answer: "no" },
    ]);
  });

  it("filters blanks as a belt, so a caller that forgot to shape cannot hit the CHECK", async () => {
    const builder = wireInsert();

    await insertCheckInAnswers("ci-1", [
      { questionId: "q-a", answer: "   " },
      { questionId: "q-b", answer: "real" },
    ]);

    expect(builder.insert).toHaveBeenCalledWith([
      { check_in_id: "ci-1", question_id: "q-b", answer: "real" },
    ]);
  });

  it("issues no statement at all when nothing survives", async () => {
    const builder = wireInsert();
    await insertCheckInAnswers("ci-1", [{ questionId: "q-a", answer: "" }]);
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it("THROWS on failure — the caller must not swallow a lost set of answers", async () => {
    wireInsert({ message: "constraint" });
    await expect(
      insertCheckInAnswers("ci-1", [{ questionId: "q-a", answer: "yes" }])
    ).rejects.toThrow(/Failed to save your answers/);
  });
});
