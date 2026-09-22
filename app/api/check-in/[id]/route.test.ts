import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsCheckIn: vi.fn(),
}));

const fromMock = vi.fn();
vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

// A factory mock replaces the module wholesale: an export the route imports and
// this list omits arrives as undefined and the route 500s at call time, not at
// import. Grow this list whenever the route's import list grows.
vi.mock("@/services/check-in-service", () => ({
  getTrainingEventDetailsForCheckIn: vi.fn(),
  getCheckInAnswers: vi.fn(),
  getCheckInExerciseHighlights: vi.fn(),
  getCheckInPeriodAdherence: vi.fn(),
  mapExerciseHighlight: (row: unknown) => row,
}));

import { GET } from "./route";
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";
import {
  getTrainingEventDetailsForCheckIn,
  getCheckInAnswers,
  getCheckInExerciseHighlights,
  getCheckInPeriodAdherence,
} from "@/services/check-in-service";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * The check-in's saved copy (lib/check-in/sent-snapshot.ts), as the row
 * carries it: what it reported when it was sent. The route maps the row with
 * the real mapper, so the readings on the payload come from here.
 */
const SENT_COPY = {
  version: 1,
  day: "2026-05-14",
  readings: { weight: 80.4, bodyFat: 19.2, waist: null, hips: null, chest: null, arms: null, thighs: null },
  standing: { weight: 80.4, bodyFat: 19.2 },
  goal: null,
  goalProgress: {},
  nutritionPlan: null,
  period: null,
  questions: [],
};

/** A fetched check-in row with its client embed and its saved copy. */
const fetchedRow = (overrides: Record<string, unknown> = {}) => ({
  id: "ci-1",
  client_id: "client-1",
  status: "reviewed",
  period_start: "2026-05-08",
  period_end: "2026-05-14",
  created_at: "2026-05-14T12:00:00Z",
  sent_snapshot: SENT_COPY,
  clients: { id: "client-1", name: "Alex", email: "a@x.com", avatar_url: null },
  ...overrides,
});
const req = () => new NextRequest("https://t.dev/api/check-in/ci-1");

function mockCheckInRow(result: { data: unknown; error: unknown }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
  fromMock.mockReturnValue(q);
  return q;
}

describe("GET /api/check-in/[id] (coach)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsCheckIn).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
      checkIn: { id: "ci-1", clientId: "client-1" },
    } as any);
    vi.mocked(getCheckInExerciseHighlights).mockResolvedValue([]);
    vi.mocked(getCheckInAnswers).mockResolvedValue([]);
    vi.mocked(getTrainingEventDetailsForCheckIn).mockResolvedValue([
      {
        eventId: "e-1",
        date: "2026-05-12",
        sessionName: "Improvised",
        status: "scheduled",
        logStatus: "not_logged",
        completionQuality: null,
        trainingSessionId: null,
        sessionLogId: null,
      },
    ]);
  });

  it("carries the period's server-computed adherence onto the payload", async () => {
    // The renderers take their DENOMINATOR from `periodAdherence.dates.length`.
    // If this field goes missing the nutrition and habit cells silently fall to
    // their empty states rather than erroring, so it is asserted here.
    const periodAdherence = {
      dates: ["2026-05-08", "2026-05-09"],
      loggedDates: ["2026-05-08"],
      nutrition: { rail: [], onTarget: 1, loggedDays: 1, targetedDays: 2, daysOnTargetPct: 50 },
      habits: { rail: [], avgPct: 50, daysBelow50: 0, perHabit: [] },
    };
    vi.mocked(getCheckInPeriodAdherence).mockReturnValue(periodAdherence as never);
    mockCheckInRow({ data: fetchedRow(), error: null });

    const body = await (await GET(req(), params("ci-1"))).json();

    expect(body.periodAdherence).toEqual(periodAdherence);
    // Read from the check-in's saved copy: the mapped check-in carries it.
    expect(getCheckInPeriodAdherence).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ci-1", sentSnapshot: expect.objectContaining({ version: 1 }) })
    );
  });

  it("carries the custom-question answers onto the checkIn payload, labelled from the check-in's copy", async () => {
    vi.mocked(getCheckInAnswers).mockResolvedValue([
      { questionId: "q-a", prompt: "How was sleep?", answer: "badly" },
    ]);
    mockCheckInRow({ data: fetchedRow(), error: null });

    const body = await (await GET(req(), params("ci-1"))).json();

    expect(body.checkIn.customAnswers).toEqual([
      { questionId: "q-a", prompt: "How was sleep?", answer: "badly" },
    ]);
    // Handed the check-in with its copy, whose wording labels each answer.
    expect(getCheckInAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ci-1", sentSnapshot: expect.objectContaining({ questions: [] }) })
    );
  });

  it("carries the period's own workouts for a historical check-in without a 500", async () => {
    mockCheckInRow({ data: fetchedRow(), error: null });

    const res = await GET(req(), params("ci-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    // Beside the check-in, not on it: the workouts describe the PERIOD.
    expect(body.checkIn.sessionCompletions).toBeUndefined();
    expect(body.trainingEventDetails).toHaveLength(1);
    expect(body.trainingEventDetails[0]).toMatchObject({
      eventId: "e-1",
      trainingSessionId: null, // tolerated
      sessionName: "Improvised",
      completionQuality: null,
    });
    // The read got the mapped check-in (with stored period).
    expect(getTrainingEventDetailsForCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ci-1", clientId: "client-1", periodStart: "2026-05-08" })
    );
  });

  it("IDOR: 403 when the coach does not own the check-in's client", async () => {
    vi.mocked(requireCoachOwnsCheckIn).mockResolvedValue({
      authorized: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as any);

    const res = await GET(req(), params("ci-1"));
    expect(res.status).toBe(403);
    expect(getTrainingEventDetailsForCheckIn).not.toHaveBeenCalled();
  });

  it("404 when the check-in row is missing", async () => {
    mockCheckInRow({ data: null, error: { message: "not found" } });

    const res = await GET(req(), params("ci-1"));
    expect(res.status).toBe(404);
  });

  it("serves the check-in as it was sent — its reported readings ride on the payload, its saved copy stays on the server", async () => {
    mockCheckInRow({ data: fetchedRow(), error: null });

    const body = await (await GET(req(), params("ci-1"))).json();

    // The readings are the copy's, through the real mapper…
    expect(body.checkIn.weight).toBe(80.4);
    expect(body.checkIn.bodyFatPercentage).toBe(19.2);
    // …and the copy itself never crosses to the browser, nor the raw row.
    expect(body.checkIn).not.toHaveProperty("sentSnapshot");
    expect(body.checkIn).not.toHaveProperty("sent_snapshot");
    expect(body.checkIn).not.toHaveProperty("client_id");
    expect(body.client).toEqual({ id: "client-1", name: "Alex", email: "a@x.com", avatar_url: null });
  });

  it("500s on a check-in with no saved copy rather than inventing its week from today", async () => {
    vi.mocked(getCheckInPeriodAdherence).mockImplementation(() => {
      throw new Error("Check-in ci-1 has no saved copy");
    });
    mockCheckInRow({ data: fetchedRow({ sent_snapshot: null }), error: null });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req(), params("ci-1"));

    expect(res.status).toBe(500);
    error.mockRestore();
  });
});
