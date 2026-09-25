import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/content-item-service", () => ({
  getContentById: vi.fn(),
}));

vi.mock("@/services/content-storage-service", () => ({
  getContentFileSignedUrl: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { GET } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedClientId, getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getContentById } from "@/services/content-item-service";
import { getContentFileSignedUrl } from "@/services/content-storage-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import type { ContentItem } from "@/types/content";

const COACH = "coach-41";
const OTHER_COACH = "coach-58";
const CLIENT = "client-63"; // an active client of COACH
const OTHER_CLIENT = "client-72"; // an active client of OTHER_COACH
const SIBLING = "client-95"; // another active client of COACH
const DEACTIVATED = "client-87"; // a client of COACH who is no longer active

function item(id: string, fields: Partial<ContentItem>): ContentItem {
  return {
    id,
    coachId: COACH,
    title: `Item ${id}`,
    type: "pdf",
    metadata: {},
    isLibrary: false,
    sortOrder: 0,
    createdAt: "2026-09-02T08:14:00.000Z",
    updatedAt: "2026-09-02T08:14:00.000Z",
    ...fields,
  };
}

const LIBRARY = item("content-104", {
  isLibrary: true,
  storagePath: `${COACH}/content-104/1790301104-mobility-guide.pdf`,
  fileName: "mobility-guide.pdf",
  mimeType: "application/pdf",
});
const ASSIGNED = item("content-117", {
  storagePath: `${COACH}/content-117/1790301117-deload-week.pdf`,
  fileName: "deload-week.pdf",
  mimeType: "application/pdf",
});
// Assigned, but to SIBLING alone.
const UNASSIGNED = item("content-129", {
  storagePath: `${COACH}/content-129/1790301129-race-plan.pdf`,
  fileName: "race-plan.pdf",
  mimeType: "application/pdf",
});
const LINK = item("content-136", { type: "hyperlink", url: "https://example.com/hip-flexor-routine" });

const ITEMS = new Map([LIBRARY, ASSIGNED, UNASSIGNED, LINK].map((c) => [c.id, c]));

// The rows the service role reads past every rule in the database, so a read's
// filters are its whole scope: a filter dropped from a read changes who opens
// what here.
const ROWS: Record<string, Array<Record<string, unknown>>> = {
  clients: [
    { id: CLIENT, coach_id: COACH, active: true },
    { id: OTHER_CLIENT, coach_id: OTHER_COACH, active: true },
    { id: SIBLING, coach_id: COACH, active: true },
    { id: DEACTIVATED, coach_id: COACH, active: false },
  ],
  content_assignments: [
    { id: "assignment-141", content_id: ASSIGNED.id, client_id: CLIENT },
    { id: "assignment-152", content_id: UNASSIGNED.id, client_id: SIBLING },
    { id: "assignment-163", content_id: LINK.id, client_id: CLIENT },
  ],
};

type Read = { table: string; columns: string; filters: Array<[string, unknown]> };
let reads: Read[] = [];
let failingTable: string | null = null;

function serviceRole(table: string) {
  const read: Read = { table, columns: "", filters: [] };
  reads.push(read);
  const builder = {
    select: (columns: string) => {
      read.columns = columns;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      read.filters.push([column, value]);
      return builder;
    },
    maybeSingle: () => {
      if (table === failingTable) {
        return Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout" } });
      }
      const match = (ROWS[table] ?? []).find((row) => read.filters.every(([column, value]) => row[column] === value));
      return Promise.resolve({ data: match ? { id: match.id } : null, error: null });
    },
  };
  return builder;
}

function download(contentId: string) {
  const request = new NextRequest(`http://localhost:3000/api/content/download/${contentId}`, { method: "GET" });
  return { request, run: () => GET(request, { params: Promise.resolve({ contentId }) }) };
}

/** Who the auth seam says the session is. */
function signedInAs(who: { coach?: string; client?: string }) {
  vi.mocked(getAuthenticatedCoachId).mockResolvedValue(who.coach ?? null);
  vi.mocked(getAuthenticatedClientId).mockResolvedValue(who.client ?? null);
}

const DENIED = { success: false, error: "Access denied" };
const UNAUTHORIZED = { success: false, error: "Unauthorized" };

describe("GET /api/content/download/[contentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads = [];
    failingTable = null;
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(supabaseAdmin.from).mockImplementation(serviceRole as never);
    vi.mocked(getContentById).mockImplementation((id: string) => {
      const found = ITEMS.get(id);
      return found ? Promise.resolve(found) : Promise.reject(new Error("Failed to fetch content"));
    });
    vi.mocked(getContentFileSignedUrl).mockImplementation((path: string) =>
      Promise.resolve(`https://storage.example.test/object/sign/content-library/${path}?token=t-177`)
    );
  });

  it("the owning coach opens their item, the seam handed the request: a signed URL for an hour", async () => {
    signedInAs({ coach: COACH });
    const { request, run } = download(UNASSIGNED.id);

    const res = await run();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        url: `https://storage.example.test/object/sign/content-library/${UNASSIGNED.storagePath}?token=t-177`,
        fileName: "race-plan.pdf",
        mimeType: "application/pdf",
      },
    });
    expect(getAuthenticatedClientId).toHaveBeenCalledWith(request);
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(getContentFileSignedUrl).toHaveBeenCalledWith(UNASSIGNED.storagePath, 3600);
    // The coach's path reads nothing but the item.
    expect(reads).toEqual([]);
  });

  it("another coach is denied: 403, no URL minted", async () => {
    signedInAs({ coach: OTHER_COACH });

    const res = await download(LIBRARY.id).run();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(DENIED);
    expect(getContentFileSignedUrl).not.toHaveBeenCalled();
  });

  it("the coach's active client opens a library item, read by their id, the item's coach and active", async () => {
    signedInAs({ client: CLIENT });

    const res = await download(LIBRARY.id).run();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { fileName: "mobility-guide.pdf" } });
    expect(reads).toEqual([
      {
        table: "clients",
        columns: "id",
        filters: [
          ["id", CLIENT],
          ["coach_id", COACH],
          ["active", true],
        ],
      },
    ]);
    // A client's download checks the session once: the coach is never asked.
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
  });

  it("the coach's active client opens an item assigned to them, the assignment read by the item and the client", async () => {
    signedInAs({ client: CLIENT });

    const res = await download(ASSIGNED.id).run();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { fileName: "deload-week.pdf" } });
    expect(reads.map((r) => r.table)).toEqual(["clients", "content_assignments"]);
    expect(reads[1].filters).toEqual([
      ["content_id", ASSIGNED.id],
      ["client_id", CLIENT],
    ]);
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
  });

  it("the coach's active client is denied an item outside the library assigned to someone else: 403", async () => {
    signedInAs({ client: CLIENT });

    const res = await download(UNASSIGNED.id).run();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(DENIED);
    expect(getContentFileSignedUrl).not.toHaveBeenCalled();
  });

  it("another coach's client is denied, even a library item: 403", async () => {
    signedInAs({ client: OTHER_CLIENT });

    const res = await download(LIBRARY.id).run();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(DENIED);
  });

  // The seam no longer resolves a deactivated client, and resolves no one for
  // a session with neither a coach row nor an active client row: both are the
  // auth seam's 401 (CONVENTIONS §8), before the item is read.
  it("a session the seam resolves to neither role is 401, and the item is never read", async () => {
    signedInAs({});

    const res = await download(LIBRARY.id).run();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(getContentById).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  });

  // The seam caches a client for up to 60 seconds; the route's own read keeps
  // a client deactivated inside that window out.
  it("a deactivated client the seam still holds is denied by the route's own read: 403", async () => {
    signedInAs({ client: DEACTIVATED });

    const res = await download(LIBRARY.id).run();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(DENIED);
  });

  it("a client an item is not open to who is also its coach opens it", async () => {
    signedInAs({ client: SIBLING, coach: COACH });

    const res = await download(ASSIGNED.id).run();

    expect(res.status).toBe(200);
    expect(getAuthenticatedCoachId).toHaveBeenCalledTimes(1);
  });

  it("a failed read opens nothing: 403, and the failure is logged", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    signedInAs({ client: CLIENT });

    failingTable = "clients";
    const clientReadFails = await download(LIBRARY.id).run();
    failingTable = "content_assignments";
    const assignmentReadFails = await download(ASSIGNED.id).run();

    expect(clientReadFails.status).toBe(403);
    expect(assignmentReadFails.status).toBe(403);
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it("a link answers its URL", async () => {
    signedInAs({ coach: COACH });

    const res = await download(LINK.id).run();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { url: "https://example.com/hip-flexor-routine" } });
    expect(getContentFileSignedUrl).not.toHaveBeenCalled();
  });

  it("an item that does not exist is a 500, as before", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    signedInAs({ coach: COACH });

    const res = await download("content-190").run();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to get download URL" });
    logged.mockRestore();
  });

  it("a rate-limited request stops at the limiter", async () => {
    vi.mocked(apiRateLimit).mockResolvedValue(
      NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 })
    );

    const res = await download(LIBRARY.id).run();

    expect(res.status).toBe(429);
    expect(getAuthenticatedClientId).not.toHaveBeenCalled();
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
    expect(getContentById).not.toHaveBeenCalled();
  });
});
