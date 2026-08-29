import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";

const request = () =>
  new NextRequest("http://localhost:3000/api/check-ins/unreviewed", {
    method: "GET",
  });

/** `clients` resolves to the coach's ids at `.eq`; `check_ins` records its
 *  filters and resolves to `rows` at `.limit`. */
function wireSupabase(clientIds: string[], rows: unknown[]) {
  const checkIns: Record<string, ReturnType<typeof vi.fn>> = {};
  checkIns.select = vi.fn(() => checkIns);
  checkIns.in = vi.fn(() => checkIns);
  checkIns.order = vi.fn(() => checkIns);
  checkIns.limit = vi.fn().mockResolvedValue({ data: rows, error: null });

  const clients: Record<string, ReturnType<typeof vi.fn>> = {};
  clients.select = vi.fn(() => clients);
  clients.eq = vi.fn().mockResolvedValue({
    data: clientIds.map((id) => ({ id })),
    error: null,
  });

  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
    table === "clients" ? clients : checkIns) as never);
  return { checkIns, clients };
}

describe("GET /api/check-ins/unreviewed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
  });

  it("401s without a coach", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValueOnce(null);
    const { checkIns } = wireSupabase(["c1"], []);

    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(checkIns.select).not.toHaveBeenCalled();
  });

  it("answers an empty queue without reading check_ins when the coach has no clients", async () => {
    const { checkIns } = wireSupabase([], []);

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkIns: [], total: 0 });
    expect(checkIns.select).not.toHaveBeenCalled();
  });

  it("lists pending AND ai_processed check-ins, scoped to the coach's clients (D2.2)", async () => {
    const row = {
      id: "ci-1",
      client_id: "c1",
      status: "pending",
      created_at: "2026-08-28T10:00:00Z",
      updated_at: "2026-08-28T10:00:00Z",
      client: { id: "c1", name: "Jane Doe", email: "jane@example.com", avatar_url: null },
    };
    const { checkIns, clients } = wireSupabase(["c1", "c2"], [row]);

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(clients.eq).toHaveBeenCalledWith("coach_id", "coach-1");
    expect(checkIns.in).toHaveBeenCalledWith("status", ["pending", "ai_processed"]);
    expect(checkIns.in).toHaveBeenCalledWith("client_id", ["c1", "c2"]);
    expect(body.total).toBe(1);
    expect(body.checkIns[0]).toMatchObject({
      id: "ci-1",
      clientId: "c1",
      status: "pending",
      clientName: "Jane Doe",
      clientEmail: "jane@example.com",
      clientAvatarUrl: null,
    });
  });

  it("500s when the check_ins read fails", async () => {
    const { checkIns } = wireSupabase(["c1"], []);
    checkIns.limit.mockResolvedValue({ data: null, error: { message: "boom" } });

    const res = await GET(request());

    expect(res.status).toBe(500);
  });
});
