import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./training-event-service", () => ({
  getEventSummariesForDate: vi.fn(),
}));

vi.mock("./daily-context-service", () => ({
  getNutritionForDate: vi.fn(),
}));

vi.mock("./daily-logs-service", () => ({
  getTodayLog: vi.fn(),
}));

vi.mock("./daily-habits-service", () => ({
  getClientHabits: vi.fn(),
  getTodayHabitLogs: vi.fn(),
}));

vi.mock("./client-program-service", () => ({
  getClientProgram: vi.fn(),
}));

import { getDaySummary } from "./client-day-service";
import { getEventSummariesForDate } from "./training-event-service";
import { getNutritionForDate } from "./daily-context-service";
import { getTodayLog } from "./daily-logs-service";
import { getClientHabits, getTodayHabitLogs } from "./daily-habits-service";
import { getClientProgram } from "./client-program-service";

const CLIENT_ID = "client-1";
const DATE = "2026-05-08";

const mockTrainingSummaries = vi.mocked(getEventSummariesForDate);
const mockNutrition = vi.mocked(getNutritionForDate);
const mockTodayLog = vi.mocked(getTodayLog);
const mockHabits = vi.mocked(getClientHabits);
const mockHabitLogs = vi.mocked(getTodayHabitLogs);
const mockProgram = vi.mocked(getClientProgram);

function setDefaults() {
  mockTrainingSummaries.mockResolvedValue([]);
  mockNutrition.mockResolvedValue({ consumed: null, target: null, source: null });
  mockTodayLog.mockResolvedValue(null);
  mockHabits.mockResolvedValue([]);
  mockHabitLogs.mockResolvedValue([]);
  mockProgram.mockResolvedValue(null);
}

describe("client-day-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaults();
  });

  // ---- Empty day ----

  it("returns empty summaries for a day with no data", async () => {
    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result).toEqual({
      phase: null,
      training: [],
      nutrition: null,
      wellness: { hasLog: false },
      habits: { totalCount: 0, loggedCount: 0 },
    });
  });

  // ---- Training: unlogged ----

  it("returns completionQuality null for unlogged event", async () => {
    mockTrainingSummaries.mockResolvedValue([
      {
        eventId: "e1",
        sessionName: "Push Day",
        sessionFocus: "chest",
        completionQuality: null,
        loggedExerciseCount: 0,
        prescribedExerciseCount: 4,
      },
    ]);

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.training).toHaveLength(1);
    expect(result.training[0].completionQuality).toBeNull();
    expect(result.training[0].loggedExerciseCount).toBe(0);
    expect(result.training[0].prescribedExerciseCount).toBe(4);
  });

  // ---- Training: quick-logged ----

  it("returns completionQuality set with loggedExerciseCount 0 for quick-logged event", async () => {
    mockTrainingSummaries.mockResolvedValue([
      {
        eventId: "e1",
        sessionName: "Push Day",
        sessionFocus: null,
        completionQuality: "full",
        loggedExerciseCount: 0,
        prescribedExerciseCount: 4,
      },
    ]);

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.training[0].completionQuality).toBe("full");
    expect(result.training[0].loggedExerciseCount).toBe(0);
  });

  // ---- Training: detailed-logged ----

  it("returns loggedExerciseCount > 0 for detailed-logged event", async () => {
    mockTrainingSummaries.mockResolvedValue([
      {
        eventId: "e1",
        sessionName: "Push Day",
        sessionFocus: "chest",
        completionQuality: "partial",
        loggedExerciseCount: 3,
        prescribedExerciseCount: 5,
      },
    ]);

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.training[0].completionQuality).toBe("partial");
    expect(result.training[0].loggedExerciseCount).toBe(3);
  });

  // ---- Training: multiple sessions ----

  it("returns array for multiple training sessions", async () => {
    mockTrainingSummaries.mockResolvedValue([
      {
        eventId: "e1",
        sessionName: "Push Day",
        sessionFocus: null,
        completionQuality: "full",
        loggedExerciseCount: 4,
        prescribedExerciseCount: 4,
      },
      {
        eventId: "e2",
        sessionName: "Cardio",
        sessionFocus: "conditioning",
        completionQuality: null,
        loggedExerciseCount: 0,
        prescribedExerciseCount: 2,
      },
    ]);

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.training).toHaveLength(2);
    expect(result.training[0].sessionName).toBe("Push Day");
    expect(result.training[1].sessionName).toBe("Cardio");
  });

  // ---- Nutrition: target exists but not logged ----

  it("returns hasLog false with the target calories when an event target exists but no log", async () => {
    mockNutrition.mockResolvedValue({
      consumed: null,
      target: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
      source: "event",
    });

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.nutrition).toEqual({
      hasLog: false,
      caloriesConsumed: null,
      targetCalories: 2000,
    });
  });

  // ---- Nutrition: logged ----

  it("returns hasLog true with consumed + target calories when a log exists", async () => {
    mockNutrition.mockResolvedValue({
      consumed: { calories: 1900, proteinG: 150, carbsG: 190, fatG: 60 },
      target: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
      source: "log",
    });

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.nutrition).toEqual({
      hasLog: true,
      caloriesConsumed: 1900,
      targetCalories: 2000,
    });
  });

  // ---- Nutrition: no log and no event ----

  it("returns null when there is no nutrition log or event", async () => {
    mockNutrition.mockResolvedValue({ consumed: null, target: null, source: null });

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.nutrition).toBeNull();
  });

  // ---- Wellness: spine exists but no wellness fields ----

  it("returns hasLog false when daily log exists but wellness fields are empty", async () => {
    mockTodayLog.mockResolvedValue({
      id: "dl1",
      clientId: CLIENT_ID,
      date: DATE,
      mood: undefined,
      energy: undefined,
      sleep: undefined,
      stress: undefined,
      caloriesConsumed: 2100,
      createdAt: "2026-05-08T00:00:00Z",
      updatedAt: "2026-05-08T00:00:00Z",
    } as any);

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.wellness).toEqual({ hasLog: false });
  });

  // ---- Wellness: fields present ----

  it("returns hasLog true when any wellness field is present", async () => {
    mockTodayLog.mockResolvedValue({
      id: "dl1",
      clientId: CLIENT_ID,
      date: DATE,
      mood: 4,
      energy: undefined,
      sleep: undefined,
      stress: undefined,
      createdAt: "2026-05-08T00:00:00Z",
      updatedAt: "2026-05-08T00:00:00Z",
    } as any);

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.wellness).toEqual({ hasLog: true });
  });

  // ---- Habits: filters for completed only ----

  it("counts only completed habit logs", async () => {
    mockHabits.mockResolvedValue([
      { id: "h1", name: "Water" },
      { id: "h2", name: "Walk" },
      { id: "h3", name: "Read" },
    ] as any);
    mockHabitLogs.mockResolvedValue([
      { dailyHabitId: "h1", completed: true },
      { dailyHabitId: "h2", completed: false },
    ] as any);

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.habits).toEqual({ totalCount: 3, loggedCount: 1 });
  });

  // ---- Phase: no program ----

  it("returns phase null when client has no program", async () => {
    mockProgram.mockResolvedValue(null);

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.phase).toBeNull();
  });

  // ---- Phase: active with computed weekInPhase ----

  it("returns active PhaseSummary with computed weekInPhase from startDate", async () => {
    mockProgram.mockResolvedValue({
      roadmap: {
        id: "r1",
        name: "Roadmap",
        longTermGoal: null,
        goalWeight: null,
        goalBodyFatPercentage: null,
        status: "active",
        startedAt: null,
        targetEndDate: null,
      },
      phases: [
        {
          id: "p1",
          name: "Strength Block",
          description: "Build base",
          objectives: null,
          orderIndex: 0,
          status: "active",
          startDate: "2026-04-01",
          endDate: null,
          durationWeeks: 8,
          phaseGoalWeight: null,
          phaseGoalBodyFatPercentage: null,
          coachReflection: null,
          milestones: [],
        },
      ],
      activePhaseId: "p1",
      weightUnit: "lbs",
      metrics: { startingWeight: null, currentWeight: null },
    });

    const result = await getDaySummary(CLIENT_ID, "2026-04-15");

    expect(result.phase).toEqual({
      id: "p1",
      name: "Strength Block",
      weekInPhase: 3,
      goal: "Build base",
      state: "active",
    });
  });

  // ---- Phase: active without startDate ----

  it("returns active PhaseSummary with weekInPhase null when phase has no startDate", async () => {
    mockProgram.mockResolvedValue({
      roadmap: {
        id: "r1",
        name: "Roadmap",
        longTermGoal: null,
        goalWeight: null,
        goalBodyFatPercentage: null,
        status: "active",
        startedAt: null,
        targetEndDate: null,
      },
      phases: [
        {
          id: "p1",
          name: "Hypertrophy",
          description: null,
          objectives: null,
          orderIndex: 0,
          status: "active",
          startDate: null,
          endDate: null,
          durationWeeks: null,
          phaseGoalWeight: null,
          phaseGoalBodyFatPercentage: null,
          coachReflection: null,
          milestones: [],
        },
      ],
      activePhaseId: "p1",
      weightUnit: "lbs",
      metrics: { startingWeight: null, currentWeight: null },
    });

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.phase).toEqual({
      id: "p1",
      name: "Hypertrophy",
      weekInPhase: null,
      goal: null,
      state: "active",
    });
  });

  // ---- Phase: transitioning ----

  it("returns transitioning PhaseSummary when no active phase but a planned phase exists", async () => {
    mockProgram.mockResolvedValue({
      roadmap: {
        id: "r1",
        name: "Roadmap",
        longTermGoal: null,
        goalWeight: null,
        goalBodyFatPercentage: null,
        status: "active",
        startedAt: null,
        targetEndDate: null,
      },
      phases: [
        {
          id: "p1",
          name: "Recovery",
          description: "Deload",
          objectives: null,
          orderIndex: 0,
          status: "completed",
          startDate: "2026-03-01",
          endDate: "2026-04-30",
          durationWeeks: 8,
          phaseGoalWeight: null,
          phaseGoalBodyFatPercentage: null,
          coachReflection: null,
          milestones: [],
        },
        {
          id: "p2",
          name: "Power Cycle",
          description: "Heavy compounds",
          objectives: null,
          orderIndex: 1,
          status: "planned",
          startDate: null,
          endDate: null,
          durationWeeks: 6,
          phaseGoalWeight: null,
          phaseGoalBodyFatPercentage: null,
          coachReflection: null,
          milestones: [],
        },
      ],
      activePhaseId: null,
      weightUnit: "lbs",
      metrics: { startingWeight: null, currentWeight: null },
    });

    const result = await getDaySummary(CLIENT_ID, DATE);

    expect(result.phase).toEqual({
      id: "p2",
      name: "Power Cycle",
      weekInPhase: null,
      goal: "Heavy compounds",
      state: "transitioning",
    });
  });
});
