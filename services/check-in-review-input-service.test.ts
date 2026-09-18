import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./check-in-details-service", () => ({
  getCheckInWithDetails: vi.fn(),
  getCheckInPeriodAdherence: vi.fn(),
  resolveCheckInReportingPeriod: vi.fn(),
}));
vi.mock("./client-service", () => ({ getClientById: vi.fn() }));
vi.mock("./daily-logs-service", () => ({ getDailyLogs: vi.fn().mockResolvedValue([]) }));
vi.mock("./nutrition-period-service", () => ({ getCheckInNutritionPeriod: vi.fn() }));
vi.mock("./check-in-context-service", () => ({
  getExerciseSummariesForPeriod: vi.fn().mockResolvedValue(new Map()),
  getTrainingEventDetailsForPeriod: vi.fn().mockResolvedValue([]),
}));
vi.mock("./comparison-service", () => ({ buildCheckInComparison: vi.fn() }));
vi.mock("@/lib/viewer-preferences", () => ({ getCoachUnitPreference: vi.fn() }));

import { getCheckInReviewInput } from "./check-in-review-input-service";
import {
  getCheckInPeriodAdherence,
  getCheckInWithDetails,
  resolveCheckInReportingPeriod,
} from "./check-in-details-service";
import { getClientById } from "./client-service";
import { getDailyLogs } from "./daily-logs-service";
import { getCheckInNutritionPeriod } from "./nutrition-period-service";
import {
  getExerciseSummariesForPeriod,
  getTrainingEventDetailsForPeriod,
} from "./check-in-context-service";
import { buildCheckInComparison } from "./comparison-service";
import { getCoachUnitPreference } from "@/lib/viewer-preferences";

const checkIn = {
  id: "ci-1",
  clientId: "client-1",
  createdAt: "2026-09-17T23:30:00Z",
  periodStart: "2026-09-11",
  periodEnd: "2026-09-17",
  exerciseHighlights: [],
  customAnswers: [],
};
// East of UTC: the check-in's instant is 18 Sep on the client's calendar.
const client = { id: "client-1", coachId: "coach-9", name: "Jane Doe", timezone: "Europe/London" };
const nutrition = { days: [], summary: { periodDays: 7 } };
const comparison = { comparison: { previous: null, changes: {} }, goalProgress: { goalIsCurrent: false } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCheckInWithDetails).mockResolvedValue(checkIn as never);
  vi.mocked(getClientById).mockResolvedValue(client as never);
  vi.mocked(getCoachUnitPreference).mockResolvedValue("imperial");
  vi.mocked(resolveCheckInReportingPeriod).mockResolvedValue({ periodStart: "2026-09-11", periodEnd: "2026-09-17" });
  vi.mocked(getCheckInPeriodAdherence).mockResolvedValue({
    dates: ["2026-09-11", "2026-09-12"],
    loggedDates: ["2026-09-11"],
    nutrition: {} as never,
    habits: { rail: [], avgPct: null, daysBelow50: 0, perHabit: [{ id: "h-1", name: "Walk", eligibleDays: 2, completedDays: 1, pct: 50, rail: [true, false] }] },
  });
  vi.mocked(getDailyLogs).mockResolvedValue([]);
  vi.mocked(getCheckInNutritionPeriod).mockResolvedValue(nutrition as never);
  vi.mocked(getTrainingEventDetailsForPeriod).mockResolvedValue([
    { eventId: "e-1", date: "2026-09-11", sessionName: "Lower A", status: "completed", logStatus: "logged", completionQuality: "full", trainingSessionId: "s-1", sessionLogId: "log-1" },
    { eventId: "e-2", date: "2026-09-12", sessionName: "Upper A", status: "scheduled", logStatus: "not_logged", completionQuality: null, trainingSessionId: "s-2", sessionLogId: null },
  ]);
  vi.mocked(getExerciseSummariesForPeriod).mockResolvedValue(new Map([["log-1", ["Squat — 3 of 3 working sets"]]]));
  vi.mocked(buildCheckInComparison).mockResolvedValue(comparison as never);
});

describe("getCheckInReviewInput — one input for both paths", () => {
  it("returns null for a check-in that does not exist, and reads nothing else", async () => {
    vi.mocked(getCheckInWithDetails).mockResolvedValue(null);
    expect(await getCheckInReviewInput("missing")).toBeNull();
    expect(getClientById).not.toHaveBeenCalled();
    expect(getTrainingEventDetailsForPeriod).not.toHaveBeenCalled();
  });

  it("resolves the OWNING coach's unit and writes the exercise lines in it", async () => {
    const input = await getCheckInReviewInput("ci-1");
    expect(getCoachUnitPreference).toHaveBeenCalledWith("coach-9");
    expect(input?.viewer).toBe("imperial");
    expect(getExerciseSummariesForPeriod).toHaveBeenCalledWith(["log-1"], "imperial");
  });

  it("reads the stored period through the page's own reads and carries every part", async () => {
    const input = await getCheckInReviewInput("ci-1");
    expect(getTrainingEventDetailsForPeriod).toHaveBeenCalledWith("client-1", "2026-09-11", "2026-09-17");
    expect(getDailyLogs).toHaveBeenCalledWith("client-1", "2026-09-11", "2026-09-17");
    expect(getCheckInNutritionPeriod).toHaveBeenCalledWith(checkIn, "2026-09-11", "2026-09-17");
    expect(getCheckInPeriodAdherence).toHaveBeenCalledWith(checkIn);
    expect(buildCheckInComparison).toHaveBeenCalledWith(checkIn, client);
    expect(input).toMatchObject({
      clientName: "Jane Doe",
      dates: ["2026-09-11", "2026-09-12"],
      loggedDates: ["2026-09-11"],
      habits: [{ id: "h-1", name: "Walk" }],
      nutrition,
      comparison,
    });
    expect(input?.workouts).toHaveLength(2);
    expect(input?.exerciseLines.get("log-1")).toEqual(["Squat — 3 of 3 working sets"]);
  });

  it("stamps the submission with the client's day, not the server's", async () => {
    const input = await getCheckInReviewInput("ci-1");
    expect(input?.submittedOn).toBe("2026-09-18");
  });

  it("asks for exercise lines for the LOGGED sessions only", async () => {
    await getCheckInReviewInput("ci-1");
    const [ids] = vi.mocked(getExerciseSummariesForPeriod).mock.calls[0];
    expect(ids).toEqual(["log-1"]);
  });

  it("writes the review without the goal strip when the comparison read fails, and says so", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(buildCheckInComparison).mockRejectedValue(new Error("goal read down"));
    const input = await getCheckInReviewInput("ci-1");
    expect(input?.comparison).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("comparison read failed"), "goal read down");
    error.mockRestore();
  });

  it("lets a failed period read fail the review rather than writing one from half the week", async () => {
    vi.mocked(getDailyLogs).mockRejectedValue(new Error("logs down"));
    await expect(getCheckInReviewInput("ci-1")).rejects.toThrow("logs down");
  });

  it("gives a legacy row with no period the six days up to its submission, and no figures", async () => {
    vi.mocked(resolveCheckInReportingPeriod).mockResolvedValue(null);
    vi.mocked(getCheckInPeriodAdherence).mockResolvedValue(null);
    const input = await getCheckInReviewInput("ci-1");
    expect(getTrainingEventDetailsForPeriod).not.toHaveBeenCalled();
    expect(getDailyLogs).toHaveBeenCalledWith("client-1", "2026-09-12", "2026-09-18");
    expect(input).toMatchObject({
      dates: ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"],
      loggedDates: null,
      workouts: [],
      habits: [],
    });
  });
});
