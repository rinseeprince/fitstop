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
  deriveSessionCompletionsForCheckIn: vi.fn(),
  getCheckInAnswers: vi.fn(),
  getCheckInExerciseHighlights: vi.fn(),
  getCheckInPeriodAdherence: vi.fn(),
  mapExerciseHighlight: (row: unknown) => row,
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
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";
import {
  deriveSessionCompletionsForCheckIn,
  getCheckInAnswers,
  getCheckInExerciseHighlights,
  getCheckInPeriodAdherence,
} from "@/services/check-in-service";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
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
    vi.mocked(deriveSessionCompletionsForCheckIn).mockResolvedValue([
      {
        id: "e-1",
        checkInId: "ci-1",
        trainingSessionId: null,
        sessionName: "Improvised",
        dayOfWeek: "tuesday",
        completed: false,
      },
    ]);
  });

  it("carries the period's server-computed adherence onto the payload", async () => {
    // The renderers take their DENOMINATOR from `periodAdherence.dates.length`.
    // If this field goes missing the nutrition and habit cells silently fall to
    // their empty states rather than erroring, so it is asserted here.
    const periodAdherence = {
      dates: ["2026-05-08", "2026-05-09"],
      nutrition: { rail: [], onTarget: 1, loggedDays: 1, pct: 50 },
      habits: { rail: [], avgPct: 50, daysBelow50: 0, perHabit: [] },
    };
    vi.mocked(getCheckInPeriodAdherence).mockResolvedValue(periodAdherence);
    mockCheckInRow({
      data: {
        id: "ci-1",
        client_id: "client-1",
        status: "reviewed",
        created_at: "2026-05-14T12:00:00Z",
        clients: { id: "client-1", name: "Alex", email: "a@x.com", avatar_url: null },
      },
      error: null,
    });

    const body = await (await GET(req(), params("ci-1"))).json();

    expect(body.periodAdherence).toEqual(periodAdherence);
  });

  it("carries the custom-question answers onto the checkIn payload", async () => {
    vi.mocked(getCheckInAnswers).mockResolvedValue([
      { questionId: "q-a", prompt: "How was sleep?", answer: "badly" },
    ]);
    mockCheckInRow({
      data: {
        id: "ci-1",
        client_id: "client-1",
        status: "reviewed",
        created_at: "2026-05-14T12:00:00Z",
        clients: { id: "client-1", name: "Alex", email: "a@x.com", avatar_url: null },
      },
      error: null,
    });

    const body = await (await GET(req(), params("ci-1"))).json();

    expect(body.checkIn.customAnswers).toEqual([
      { questionId: "q-a", prompt: "How was sleep?", answer: "badly" },
    ]);
  });

  it("returns derived sessionCompletions for a historical check-in without a 500", async () => {
    mockCheckInRow({
      data: {
        id: "ci-1",
        client_id: "client-1",
        status: "reviewed",
        created_at: "2026-05-14T12:00:00Z",
        clients: { id: "client-1", name: "Alex", email: "a@x.com", avatar_url: null },
      },
      error: null,
    });

    const res = await GET(req(), params("ci-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checkIn.sessionCompletions).toHaveLength(1);
    expect(body.checkIn.sessionCompletions[0]).toMatchObject({
      id: "e-1",
      trainingSessionId: null, // tolerated
      sessionName: "Improvised",
      completed: false,
    });
    // Derivation got the mapped check-in (with stored period).
    expect(deriveSessionCompletionsForCheckIn).toHaveBeenCalledWith(
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
    expect(deriveSessionCompletionsForCheckIn).not.toHaveBeenCalled();
  });

  it("404 when the check-in row is missing", async () => {
    mockCheckInRow({ data: null, error: { message: "not found" } });

    const res = await GET(req(), params("ci-1"));
    expect(res.status).toBe(404);
  });
});
