import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/require-client-auth", () => ({
  requireClientAuth: vi.fn(),
}));

const fromMock = vi.fn();
vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock("@/services/check-in-service", () => ({
  deriveSessionCompletionsForCheckIn: vi.fn(),
  getCheckInExerciseHighlights: vi.fn(),
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
  getCheckInExerciseHighlights,
} from "@/services/check-in-service";

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
});
