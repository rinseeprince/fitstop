import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/content-assignment-service", () => ({
  getContentAssignments: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { GET } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getContentAssignments } from "@/services/content-assignment-service";
import { supabaseAdmin } from "@/services/supabase-admin";

const COACH = "coach-311";
const OTHER_COACH = "coach-326";
const ITEM = "content-338";
const FOREIGN_ITEM = "content-349";

// The service role reads past every rule in the database, so the read's
// filters are its whole scope.
const ITEMS = [
  { id: ITEM, coach_id: COACH },
  { id: FOREIGN_ITEM, coach_id: OTHER_COACH },
];

let filters: Array<[string, unknown]> = [];

function serviceRole() {
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    },
    single: () => {
      const match = ITEMS.find((row) => filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value));
      return Promise.resolve(
        match ? { data: { id: match.id }, error: null } : { data: null, error: { code: "PGRST116", message: "0 rows" } }
      );
    },
  };
  return builder;
}

function list(contentId: string) {
  const request = new NextRequest(`http://localhost:3000/api/content/assignments/${contentId}`, { method: "GET" });
  return { request, run: () => GET(request, { params: Promise.resolve({ contentId }) }) };
}

describe("GET /api/content/assignments/[contentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filters = [];
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH);
    vi.mocked(supabaseAdmin.from).mockImplementation(serviceRole as never);
    vi.mocked(getContentAssignments).mockResolvedValue([
      {
        id: "assignment-354",
        contentId: ITEM,
        clientId: "client-367",
        assignedBy: COACH,
        assignedAt: "2026-09-20T18:05:00.000Z",
      },
    ]);
  });

  it("lists the assignments of the coach's item, read through the server scoped to the coach", async () => {
    const { request, run } = list(ITEM);

    const res = await run();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: [
        {
          id: "assignment-354",
          contentId: ITEM,
          clientId: "client-367",
          assignedBy: COACH,
          assignedAt: "2026-09-20T18:05:00.000Z",
        },
      ],
    });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("content_items");
    expect(filters).toEqual([
      ["id", ITEM],
      ["coach_id", COACH],
    ]);
    expect(getContentAssignments).toHaveBeenCalledWith(ITEM);
  });

  it("another coach's item is 404, and its assignments are never read", async () => {
    const res = await list(FOREIGN_ITEM).run();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Content not found" });
    expect(getContentAssignments).not.toHaveBeenCalled();
  });

  it("no coach is 401: nothing is read", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await list(ITEM).run();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(getContentAssignments).not.toHaveBeenCalled();
  });
});
