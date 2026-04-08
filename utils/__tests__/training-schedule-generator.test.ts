import { describe, it, expect } from "vitest";
import { buildTrainingSchedule } from "../training-schedule-generator";
import type { TrainingPlanWithSessions, SessionLogRow, TrainingLogRow } from "@/services/schedule-data-service";

// --- Fixtures ---

const makePlan = (overrides: Partial<TrainingPlanWithSessions> = {}): TrainingPlanWithSessions => ({
  id: "plan-1",
  name: "Push Pull Legs",
  effectiveFrom: "2026-03-30", // Monday
  effectiveUntil: null,
  sessions: [
    { id: "sess-push", name: "Push Day", dayOfWeek: "monday", sessionType: "training", focus: "chest", estimatedCalories: null },
    { id: "sess-pull", name: "Pull Day", dayOfWeek: "wednesday", sessionType: "training", focus: "back", estimatedCalories: null },
    { id: "sess-legs", name: "Leg Day", dayOfWeek: "friday", sessionType: "training", focus: "legs", estimatedCalories: null },
  ],
  ...overrides,
});

const makeSessionLog = (overrides: Partial<SessionLogRow> = {}): SessionLogRow => ({
  id: "slog-1",
  clientId: "client-1",
  trainingSessionId: "sess-push",
  completionQuality: "full",
  completedAt: "2026-03-30",
  notes: null,
  ...overrides,
});

const makeTrainingLog = (overrides: Partial<TrainingLogRow> = {}): TrainingLogRow => ({
  date: "2026-03-30",
  trainingSessionId: "sess-push",
  trainingData: {
    trainingSessionId: "sess-push",
    trainingSessionName: "Push Day",
    isAlternativeSession: false,
  },
  ...overrides,
});

// Week: Mon 2026-03-30 through Sun 2026-04-05
const WEEK_DATES = [
  "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
  "2026-04-03", "2026-04-04", "2026-04-05",
];

describe("buildTrainingSchedule", () => {
  it("returns completed when prescribed session is logged with full quality", () => {
    const result = buildTrainingSchedule(
      ["2026-03-30"],
      [makePlan()],
      [makeSessionLog()],
      [makeTrainingLog()]
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("completed");
    expect(result[0].plannedSessionName).toBe("Push Day");
    expect(result[0].dayOfWeek).toBe("monday");
  });

  it("returns partial when completion_quality is partial", () => {
    const result = buildTrainingSchedule(
      ["2026-03-30"],
      [makePlan()],
      [makeSessionLog({ completionQuality: "partial" })],
      [makeTrainingLog()]
    );

    expect(result[0].status).toBe("partial");
  });

  it("returns missed when prescribed session has no log", () => {
    const result = buildTrainingSchedule(
      ["2026-03-30"],
      [makePlan()],
      [], // no session logs
      []  // no training logs
    );

    expect(result[0].status).toBe("missed");
    expect(result[0].plannedSessionName).toBe("Push Day");
  });

  it("returns completed_swap when isAlternativeSession is true", () => {
    const result = buildTrainingSchedule(
      ["2026-03-30"],
      [makePlan()],
      [makeSessionLog({ trainingSessionId: "sess-other" })],
      [makeTrainingLog({
        trainingData: {
          trainingSessionId: "sess-other",
          trainingSessionName: "Upper Body",
          isAlternativeSession: true,
        },
      })]
    );

    expect(result[0].status).toBe("completed_swap");
    expect(result[0].isAlternative).toBe(true);
  });

  it("returns completed_swap when session IDs dont match", () => {
    const result = buildTrainingSchedule(
      ["2026-03-30"],
      [makePlan()],
      [makeSessionLog({ trainingSessionId: "sess-pull" })],
      [makeTrainingLog({
        trainingData: {
          trainingSessionId: "sess-pull",
          trainingSessionName: "Pull Day",
          isAlternativeSession: false,
        },
      })]
    );

    expect(result[0].status).toBe("completed_swap");
  });

  it("returns rest when no session prescribed and no log", () => {
    // Tuesday has no prescribed session
    const result = buildTrainingSchedule(
      ["2026-03-31"], // Tuesday
      [makePlan()],
      [],
      []
    );

    expect(result[0].status).toBe("rest");
    expect(result[0].plannedSessionName).toBeNull();
  });

  it("returns rest_trained when no session prescribed but client trained", () => {
    // Tuesday has no prescribed session, but client trained anyway
    const result = buildTrainingSchedule(
      ["2026-03-31"], // Tuesday
      [makePlan()],
      [makeSessionLog({ completedAt: "2026-03-31", trainingSessionId: null })],
      [makeTrainingLog({
        date: "2026-03-31",
        trainingData: {
          trainingSessionName: "Extra Cardio",
          isAlternativeSession: false,
        },
      })]
    );

    expect(result[0].status).toBe("rest_trained");
  });

  it("handles mid-cycle plan change correctly", () => {
    const planA = makePlan({
      id: "plan-a",
      name: "Plan A",
      effectiveFrom: "2026-03-30",
      effectiveUntil: "2026-04-01", // active Mon-Wed
      sessions: [
        { id: "sess-a", name: "Plan A Push", dayOfWeek: "monday", sessionType: "training", focus: null, estimatedCalories: null },
      ],
    });
    const planB = makePlan({
      id: "plan-b",
      name: "Plan B",
      effectiveFrom: "2026-04-02",
      effectiveUntil: null, // active Thu onwards
      sessions: [
        { id: "sess-b", name: "Plan B Push", dayOfWeek: "thursday", sessionType: "training", focus: null, estimatedCalories: null },
      ],
    });

    const result = buildTrainingSchedule(
      ["2026-03-30", "2026-04-02"],
      [planA, planB],
      [],
      []
    );

    expect(result[0].plannedSessionName).toBe("Plan A Push");
    expect(result[0].status).toBe("missed");
    expect(result[1].plannedSessionName).toBe("Plan B Push");
    expect(result[1].status).toBe("missed");
  });

  it("returns rest when no plan exists for a date", () => {
    const plan = makePlan({
      effectiveFrom: "2026-04-01",
      effectiveUntil: null,
    });

    const result = buildTrainingSchedule(
      ["2026-03-30"], // Before plan starts
      [plan],
      [],
      []
    );

    expect(result[0].status).toBe("rest");
    expect(result[0].plannedSessionName).toBeNull();
  });

  it("generates full week with mixed statuses", () => {
    const result = buildTrainingSchedule(
      WEEK_DATES,
      [makePlan()],
      [
        makeSessionLog({ completedAt: "2026-03-30" }), // Mon: completed
        // Wed (04-01): missed
        makeSessionLog({ completedAt: "2026-04-03", trainingSessionId: "sess-legs", completionQuality: "full" }), // Fri: completed
      ],
      [
        makeTrainingLog({ date: "2026-03-30" }),
        makeTrainingLog({ date: "2026-04-03", trainingSessionId: "sess-legs", trainingData: { trainingSessionId: "sess-legs", trainingSessionName: "Leg Day", isAlternativeSession: false } }),
      ]
    );

    expect(result).toHaveLength(7);
    expect(result[0].status).toBe("completed");  // Mon: Push Day logged
    expect(result[1].status).toBe("rest");        // Tue: no prescription
    expect(result[2].status).toBe("missed");      // Wed: Pull Day prescribed, not logged
    expect(result[3].status).toBe("rest");        // Thu: no prescription
    expect(result[4].status).toBe("completed");   // Fri: Leg Day logged
    expect(result[5].status).toBe("rest");        // Sat: no prescription
    expect(result[6].status).toBe("rest");        // Sun: no prescription
  });
});
