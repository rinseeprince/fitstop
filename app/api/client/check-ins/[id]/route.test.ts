import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/require-client-auth", () => ({
  requireClientAuth: vi.fn(),
}));

const fromMock = vi.fn();
vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

// A spy, not the identity stub used in app/api/check-in/[id]/route.test.ts:20 —
// an identity mapper would let a snake_case/camelCase mismatch through, which is
// exactly the regression this route carried. The mapper's own field mapping is
// covered in services/check-in-details-service.test.ts; here we only prove the
// route maps at all rather than serving the raw row.
const mapExerciseHighlightMock = vi.fn();
vi.mock("@/services/check-in-service", () => ({
  getTrainingEventDetailsForCheckIn: vi.fn(),
  getCheckInAnswers: vi.fn(),
  getCheckInExerciseHighlights: vi.fn(),
  mapExerciseHighlight: (...args: unknown[]) => mapExerciseHighlightMock(...args),
}));

// The route maps the row with the REAL mapper: what the check-in reported
// comes from the copy it saved when it was sent (`sent_snapshot`), never from
// the measurement log, where a coach may since have corrected the reading.

import { GET } from "./route";
import { requireClientAuth } from "@/lib/require-client-auth";
import {
  getTrainingEventDetailsForCheckIn,
  getCheckInAnswers,
  getCheckInExerciseHighlights,
} from "@/services/check-in-service";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** A copy a check-in saved when it was sent (lib/check-in/sent-snapshot.ts). */
const sentCopy = (readings: Record<string, number>, questions: { questionId: string; prompt: string }[] = []) => ({
  version: 1,
  day: "2026-05-14",
  readings: { weight: null, bodyFat: null, waist: null, hips: null, chest: null, arms: null, thighs: null, ...readings },
  standing: { weight: readings.weight ?? null, bodyFat: readings.bodyFat ?? null },
  goal: null,
  goalProgress: {},
  nutritionPlan: null,
  period: null,
  questions,
});

/** The client's own check-in row, as the route selects it. */
const fetched = (overrides: Record<string, unknown> = {}) => ({
  id: "ci-1",
  client_id: "client-1",
  status: "pending",
  period_start: "2026-05-08",
  period_end: "2026-05-14",
  created_at: "2026-05-14T12:00:00Z",
  sent_snapshot: sentCopy({}),
  ...overrides,
});
const req = () => new NextRequest("https://t.dev/api/client/check-ins/ci-1");

// Builds the chainable supabaseAdmin.from(...).select().eq().eq().single() mock.
function mockCheckInRow(result: { data: unknown; error: unknown }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
  fromMock.mockReturnValue(q);
  return q;
}

describe("GET /api/client/check-ins/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireClientAuth).mockResolvedValue({ ok: true, clientId: "client-1" } as any);
    vi.mocked(getCheckInExerciseHighlights).mockResolvedValue([]);
    vi.mocked(getCheckInAnswers).mockResolvedValue([]);
    vi.mocked(getTrainingEventDetailsForCheckIn).mockResolvedValue([
      {
        eventId: "e-1",
        date: "2026-05-11",
        sessionName: "Push Day",
        status: "completed",
        logStatus: "logged",
        completionQuality: "full",
        trainingSessionId: "ts-1",
        sessionLogId: "log-1",
      },
    ]);
  });

  it("carries the period's own workouts, each with the quality on its log", async () => {
    mockCheckInRow({
      data: fetched(),
      error: null,
    });

    const res = await GET(req(), params("ci-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // The legacy per-session shape is gone from the wire, not renamed onto it.
    expect(body.data.sessionCompletions).toBeUndefined();
    expect(body.data.trainingEventDetails).toHaveLength(1);
    expect(body.data.trainingEventDetails[0]).toMatchObject({
      eventId: "e-1",
      sessionName: "Push Day",
      status: "completed",
      completionQuality: "full",
    });
    // The read received the mapped check-in (with period + clientId).
    expect(getTrainingEventDetailsForCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ci-1", clientId: "client-1", periodStart: "2026-05-08" })
    );
  });

  // Regression guard for 0c4cebf: this route served RAW snake_case highlight
  // rows while the client page was rewritten to read camelCase, so the card
  // rendered empty for every client. tsc could not see it —
  // app/client/check-in/[id]/page.tsx types the fetch response as `any`, so the
  // compiler checks the page against its own declaration, never against what
  // this route sends. Hence an explicit shape assertion.
  it("maps exercise highlights rather than serving the raw row", async () => {
    mockCheckInRow({
      data: fetched(),
      error: null,
    });
    const rawRow = {
      id: "h-1",
      check_in_id: "ci-1",
      exercise_id: null,
      exercise_name: "Back Squat",
      highlight_type: "pr",
      details: null,
      weight_value: 102.5,
      reps: 3,
      created_at: "2026-05-14T12:00:00Z",
    };
    vi.mocked(getCheckInExerciseHighlights).mockResolvedValue([rawRow] as any);
    mapExerciseHighlightMock.mockReturnValue({
      id: "h-1",
      exerciseName: "Back Squat",
      highlightType: "pr",
      weightValue: 102.5,
      reps: 3,
    });

    const res = await GET(req(), params("ci-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mapExerciseHighlightMock.mock.calls[0][0]).toEqual(rawRow);
    expect(body.data.exerciseHighlights).toHaveLength(1);
    expect(body.data.exerciseHighlights[0]).toMatchObject({
      exerciseName: "Back Squat",
      highlightType: "pr",
      weightValue: 102.5,
    });
    // The raw column names must not survive the boundary.
    expect(body.data.exerciseHighlights[0]).not.toHaveProperty("exercise_name");
    expect(body.data.exerciseHighlights[0]).not.toHaveProperty("weight_value");
  });

  it("IDOR: scopes the read to the authenticated client and 404s a foreign row", async () => {
    const q = mockCheckInRow({ data: null, error: { code: "PGRST116" } });

    const res = await GET(req(), params("ci-1"));
    expect(res.status).toBe(404);
    // The query filtered on client_id (IDOR guard).
    expect(q.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(getTrainingEventDetailsForCheckIn).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    vi.mocked(requireClientAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as any);

    const res = await GET(req(), params("ci-1"));
    expect(res.status).toBe(401);
  });

  it("reads back the client's own answers with their prompts", async () => {
    // The single-check-in read only. The history LIST stays sparse — embedding
    // a dictionary in a row list is what CONVENTIONS section 8 forbids.
    vi.mocked(getCheckInAnswers).mockResolvedValue([
      { questionId: "q-a", prompt: "How was sleep?", answer: "badly" },
    ]);
    mockCheckInRow({
      data: fetched({
        sent_snapshot: sentCopy({}, [
          { questionId: "00000000-0000-4000-8000-00000000b0b1", prompt: "How was sleep?" },
        ]),
      }),
      error: null,
    });

    const body = await (await GET(req(), params("ci-1"))).json();

    // Handed the check-in with its copy, whose wording labels each answer —
    // a question reworded since never relabels it.
    expect(getCheckInAnswers).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ci-1",
        sentSnapshot: expect.objectContaining({
          questions: [{ questionId: "00000000-0000-4000-8000-00000000b0b1", prompt: "How was sleep?" }],
        }),
      })
    );
    expect(body.data.customAnswers).toEqual([
      { questionId: "q-a", prompt: "How was sleep?", answer: "badly" },
    ]);
  });

  it("emits what the check-in reported, from its saved copy, and null for a reading it never carried", async () => {
    // The RN wire reads this shape: every measurement key present, canonical
    // kg/cm, `null` rather than a missing key when the check-in reported none.
    mockCheckInRow({
      data: fetched({ sent_snapshot: sentCopy({ weight: 80.4, waist: 90.6 }) }),
      error: null,
    });

    const body = await (await GET(req(), params("ci-1"))).json();

    expect(body.data.weight).toBe(80.4);
    expect(body.data.waist).toBe(90.6);
    for (const key of ["bodyFatPercentage", "hips", "chest", "arms", "thighs"]) {
      expect(body.data).toHaveProperty(key);
      expect(body.data[key]).toBeNull();
    }
    // The measurement log is never read: a reading a coach corrected there
    // since cannot reach the client's check-in.
    expect(fromMock.mock.calls.map((call) => call[0])).toEqual(["check_ins"]);
    // …and the copy itself is not on the wire.
    expect(body.data).not.toHaveProperty("sentSnapshot");
    expect(body.data).not.toHaveProperty("sent_snapshot");
  });
});

describe("the stored on-target count's denominator", () => {
  const row = (period_snapshot: unknown) => fetched({ nutrition_days_on_target: 2, period_snapshot });

  beforeEach(() => {
    vi.mocked(requireClientAuth).mockResolvedValue({ ok: true, clientId: "client-1" } as any);
    vi.mocked(getCheckInExerciseHighlights).mockResolvedValue([]);
    vi.mocked(getCheckInAnswers).mockResolvedValue([]);
    vi.mocked(getTrainingEventDetailsForCheckIn).mockResolvedValue([]);
  });

  it("is the frozen rows that carried a target — a day with no target is in no ratio", async () => {
    mockCheckInRow({
      data: row({
        generatedAt: "2026-05-14T12:00:00Z",
        training: [],
        nutrition: [
          { date: "2026-05-08", targetCalories: 2000, actualCalories: 2000 },
          { date: "2026-05-09", targetCalories: 2000, actualCalories: null },
          { date: "2026-05-10", targetCalories: null, actualCalories: 1800 },
        ],
      }),
      error: null,
    });

    const body = await (await GET(req(), params("ci-1"))).json();

    expect(body.data.nutritionDaysOnTarget).toBe(2);
    expect(body.data.nutritionTargetedDays).toBe(2);
  });

  it("is null on a row with no snapshot — a count with no denominator", async () => {
    mockCheckInRow({ data: row(null), error: null });

    const body = await (await GET(req(), params("ci-1"))).json();

    expect(body.data.nutritionTargetedDays).toBeNull();
  });
});
