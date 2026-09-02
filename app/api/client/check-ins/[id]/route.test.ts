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
  deriveSessionCompletionsForCheckIn: vi.fn(),
  getCheckInAnswers: vi.fn(),
  getCheckInExerciseHighlights: vi.fn(),
  mapExerciseHighlight: (...args: unknown[]) => mapExerciseHighlightMock(...args),
}));

// What the check-in reported lives in the measurement log, stamped with the
// check-in's id; the route reads it through the service and emits every key,
// null where the check-in carried no reading.
vi.mock("@/services/measurements-service", () => ({
  getMeasurementsForCheckIns: vi.fn(),
}));

vi.mock("@/lib/mappers", () => ({
  mapCheckInRow: (row: { id: string; client_id: string }) => ({
    id: row.id,
    clientId: row.client_id,
    periodStart: "2026-05-08",
    periodEnd: "2026-05-14",
    createdAt: "2026-05-14T12:00:00Z",
  }),
}));

import { GET } from "./route";
import { requireClientAuth } from "@/lib/require-client-auth";
import {
  deriveSessionCompletionsForCheckIn,
  getCheckInAnswers,
  getCheckInExerciseHighlights,
} from "@/services/check-in-service";
import { getMeasurementsForCheckIns } from "@/services/measurements-service";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
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
    vi.mocked(getMeasurementsForCheckIns).mockResolvedValue(new Map());
    vi.mocked(deriveSessionCompletionsForCheckIn).mockResolvedValue([
      {
        id: "e-1",
        checkInId: "ci-1",
        trainingSessionId: "ts-1",
        sessionName: "Push Day",
        dayOfWeek: "monday",
        completed: true,
        completionQuality: "full",
      },
    ]);
  });

  it("returns derived sessionCompletions in the preserved camelCase shape", async () => {
    mockCheckInRow({
      data: { id: "ci-1", client_id: "client-1", status: "pending", created_at: "2026-05-14T12:00:00Z" },
      error: null,
    });

    const res = await GET(req(), params("ci-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.sessionCompletions).toHaveLength(1);
    expect(body.data.sessionCompletions[0]).toMatchObject({
      id: "e-1",
      sessionName: "Push Day",
      completed: true,
      completionQuality: "full",
    });
    // Derivation received the mapped check-in (with period + clientId).
    expect(deriveSessionCompletionsForCheckIn).toHaveBeenCalledWith(
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
      data: { id: "ci-1", client_id: "client-1", status: "pending", created_at: "2026-05-14T12:00:00Z" },
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
    expect(deriveSessionCompletionsForCheckIn).not.toHaveBeenCalled();
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
      data: {
        id: "ci-1",
        client_id: "client-1",
        status: "pending",
        created_at: "2026-05-14T12:00:00Z",
      },
      error: null,
    });

    const body = await (await GET(req(), params("ci-1"))).json();

    expect(getCheckInAnswers).toHaveBeenCalledWith("ci-1");
    expect(body.data.customAnswers).toEqual([
      { questionId: "q-a", prompt: "How was sleep?", answer: "badly" },
    ]);
  });

  it("emits the check-in's readings from the measurement log, and null for a reading it never carried", async () => {
    // The RN wire reads this shape: every measurement key present, canonical
    // kg/cm, `null` rather than a missing key when the check-in reported none.
    vi.mocked(getMeasurementsForCheckIns).mockResolvedValue(
      new Map([["ci-1", { weight: 80.4, waist: 90 }]])
    );
    mockCheckInRow({
      data: { id: "ci-1", client_id: "client-1", status: "pending", created_at: "2026-05-14T12:00:00Z" },
      error: null,
    });

    const body = await (await GET(req(), params("ci-1"))).json();

    expect(getMeasurementsForCheckIns).toHaveBeenCalledWith(["ci-1"]);
    expect(body.data.weight).toBe(80.4);
    expect(body.data.waist).toBe(90);
    for (const key of ["bodyFatPercentage", "hips", "chest", "arms", "thighs"]) {
      expect(body.data).toHaveProperty(key);
      expect(body.data[key]).toBeNull();
    }
  });
});

