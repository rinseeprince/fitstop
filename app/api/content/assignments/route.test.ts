import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn(),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/content-assignment-service", () => ({
  assignContentToClient: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { POST } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { assignContentToClient } from "@/services/content-assignment-service";
import { supabaseAdmin } from "@/services/supabase-admin";

const COACH = "7a1c0e21-4c5d-4e6f-8a01-000000000211";
const OTHER_COACH = "7a1c0e21-4c5d-4e6f-8a01-000000000224";
const ITEM = "0c7e5a33-1b2d-4f60-9a11-000000000236";
const FOREIGN_ITEM = "0c7e5a33-1b2d-4f60-9a11-000000000247";
const CLIENT = "3f9d2b44-5e6a-4b70-8c21-000000000259";
const PAUSED_CLIENT = "3f9d2b44-5e6a-4b70-8c21-000000000262";
const FOREIGN_CLIENT = "3f9d2b44-5e6a-4b70-8c21-000000000278";

// The service role reads past every rule in the database, so each read's
// filters are its whole scope.
const ROWS: Record<string, Array<Record<string, unknown>>> = {
  content_items: [
    { id: ITEM, coach_id: COACH },
    { id: FOREIGN_ITEM, coach_id: OTHER_COACH },
  ],
  clients: [
    { id: CLIENT, coach_id: COACH, active: true },
    { id: PAUSED_CLIENT, coach_id: COACH, active: false },
    { id: FOREIGN_CLIENT, coach_id: OTHER_COACH, active: true },
  ],
};

type Read = { table: string; filters: Array<[string, unknown]> };
let reads: Read[] = [];

function serviceRole(table: string) {
  const read: Read = { table, filters: [] };
  reads.push(read);
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      read.filters.push([column, value]);
      return builder;
    },
    // `.single()` on no row is PostgREST's PGRST116 error.
    single: () => {
      const match = (ROWS[table] ?? []).find((row) => read.filters.every(([column, value]) => row[column] === value));
      return Promise.resolve(
        match ? { data: { id: match.id }, error: null } : { data: null, error: { code: "PGRST116", message: "0 rows" } }
      );
    },
  };
  return builder;
}

function assign(body: unknown) {
  const request = new NextRequest("http://localhost:3000/api/content/assignments", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { request, run: () => POST(request) };
}

describe("POST /api/content/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads = [];
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH);
    vi.mocked(supabaseAdmin.from).mockImplementation(serviceRole as never);
    vi.mocked(assignContentToClient).mockResolvedValue({
      id: "assignment-285",
      contentId: ITEM,
      clientId: CLIENT,
      assignedBy: COACH,
      assignedAt: "2026-09-25T07:31:00.000Z",
    });
  });

  it("assigns the coach's item to the coach's client, both read through the server scoped to the coach", async () => {
    const { request, run } = assign({ contentId: ITEM, clientId: CLIENT });

    const res = await run();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        id: "assignment-285",
        contentId: ITEM,
        clientId: CLIENT,
        assignedBy: COACH,
        assignedAt: "2026-09-25T07:31:00.000Z",
      },
      message: "Content assigned successfully",
    });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(reads).toEqual([
      { table: "content_items", filters: [["id", ITEM], ["coach_id", COACH]] },
      { table: "clients", filters: [["id", CLIENT], ["coach_id", COACH]] },
    ]);
    expect(assignContentToClient).toHaveBeenCalledWith({ contentId: ITEM, clientId: CLIENT, assignedBy: COACH });
  });

  it("another coach's item is 404, and nothing is assigned", async () => {
    const res = await assign({ contentId: FOREIGN_ITEM, clientId: CLIENT }).run();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Content not found" });
    expect(assignContentToClient).not.toHaveBeenCalled();
  });

  it("another coach's client is 404, and nothing is assigned", async () => {
    const res = await assign({ contentId: ITEM, clientId: FOREIGN_CLIENT }).run();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Client not found" });
    expect(assignContentToClient).not.toHaveBeenCalled();
  });

  // The coach's own clients were readable whatever their status, so they stay
  // assignable.
  it("a client of the coach who is not active can still be assigned", async () => {
    const res = await assign({ contentId: ITEM, clientId: PAUSED_CLIENT }).run();

    expect(res.status).toBe(200);
    expect(assignContentToClient).toHaveBeenCalledWith({ contentId: ITEM, clientId: PAUSED_CLIENT, assignedBy: COACH });
  });

  it("no coach is 401: nothing is read or assigned", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await assign({ contentId: ITEM, clientId: CLIENT }).run();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(reads).toEqual([]);
    expect(assignContentToClient).not.toHaveBeenCalled();
  });

  it("a body that is not two ids is 400, before anything is read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await assign({ contentId: "not-an-id", clientId: CLIENT }).run();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input" });
    expect(reads).toEqual([]);
    logged.mockRestore();
  });

  it("an item already assigned to the client is 400", async () => {
    vi.mocked(assignContentToClient).mockRejectedValue(
      new Error('Failed to assign content: duplicate key value violates unique constraint "content_assignments_content_id_client_id_key"')
    );

    const res = await assign({ contentId: ITEM, clientId: CLIENT }).run();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Content is already assigned to this client" });
  });
});
