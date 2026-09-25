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
  unassignContentFromClient: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { DELETE } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { unassignContentFromClient } from "@/services/content-assignment-service";
import { supabaseAdmin } from "@/services/supabase-admin";

const COACH = "coach-411";
const OTHER_COACH = "coach-423";
const ITEM = "content-436";
const FOREIGN_ITEM = "content-448";
const CLIENT = "client-452";
const FOREIGN_CLIENT = "client-469";

// The service role reads past every rule in the database, so each read's
// filters are its whole scope.
const ROWS: Record<string, Array<Record<string, unknown>>> = {
  content_items: [
    { id: ITEM, coach_id: COACH },
    { id: FOREIGN_ITEM, coach_id: OTHER_COACH },
  ],
  clients: [
    { id: CLIENT, coach_id: COACH },
    { id: FOREIGN_CLIENT, coach_id: OTHER_COACH },
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
    single: () => {
      const match = (ROWS[table] ?? []).find((row) => read.filters.every(([column, value]) => row[column] === value));
      return Promise.resolve(
        match ? { data: { id: match.id }, error: null } : { data: null, error: { code: "PGRST116", message: "0 rows" } }
      );
    },
  };
  return builder;
}

function unassign(contentId: string, clientId: string) {
  const request = new NextRequest(`http://localhost:3000/api/content/assignments/${contentId}/${clientId}`, {
    method: "DELETE",
  });
  return { request, run: () => DELETE(request, { params: Promise.resolve({ contentId, clientId }) }) };
}

describe("DELETE /api/content/assignments/[contentId]/[clientId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads = [];
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH);
    vi.mocked(supabaseAdmin.from).mockImplementation(serviceRole as never);
    vi.mocked(unassignContentFromClient).mockResolvedValue(undefined);
  });

  it("unassigns the coach's item from the coach's client, both read through the server scoped to the coach", async () => {
    const { request, run } = unassign(ITEM, CLIENT);

    const res = await run();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Content unassigned successfully" });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(reads).toEqual([
      { table: "content_items", filters: [["id", ITEM], ["coach_id", COACH]] },
      { table: "clients", filters: [["id", CLIENT], ["coach_id", COACH]] },
    ]);
    expect(unassignContentFromClient).toHaveBeenCalledWith(ITEM, CLIENT);
  });

  it("another coach's item is 404, and nothing is unassigned", async () => {
    const res = await unassign(FOREIGN_ITEM, CLIENT).run();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Content not found" });
    expect(unassignContentFromClient).not.toHaveBeenCalled();
  });

  it("another coach's client is 404, and nothing is unassigned", async () => {
    const res = await unassign(ITEM, FOREIGN_CLIENT).run();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Client not found" });
    expect(unassignContentFromClient).not.toHaveBeenCalled();
  });

  it("no coach is 401: nothing is read or unassigned", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const res = await unassign(ITEM, CLIENT).run();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(reads).toEqual([]);
    expect(unassignContentFromClient).not.toHaveBeenCalled();
  });
});
