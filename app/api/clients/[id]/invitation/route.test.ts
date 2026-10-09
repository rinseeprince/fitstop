// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn() }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedCoachId: vi.fn() }));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));
vi.mock("@/services/client-service", () => ({ getClientById: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/services/email-service", () => ({ sendInvitationEmail: vi.fn(), generateInviteToken: vi.fn() }));
vi.mock("@/services/invitation-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/invitation-service")>()),
  readInvitation: vi.fn(),
  sendInvitation: vi.fn(),
}));

import { GET, POST } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { captureApiError } from "@/lib/error-handler";
import { getClientById } from "@/services/client-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { readInvitation, sendInvitation } from "@/services/invitation-service";
import type { InvitationRead } from "@/types/auth";

const COACH_ID = "coach-5";
const CLIENT_ID = "client-12";
const OWNED = { id: CLIENT_ID, coachId: COACH_ID, name: "Maya Okafor", email: "maya@example.com" };
const READ: InvitationRead = {
  hasAccount: false,
  invitation: { sentOn: "2026-10-08", expiresOn: "2026-10-15", linkWorks: true },
};
/** A link's token is 64 hex characters: no answer here carries one. */
const TOKEN_SHAPE = /[a-f0-9]{64}/i;

function call(method: "GET" | "POST") {
  const request = new NextRequest(`http://localhost:3000/api/clients/${CLIENT_ID}/invitation`, { method });
  const handler = method === "GET" ? GET : POST;
  return { request, response: handler(request, { params: Promise.resolve({ id: CLIENT_ID }) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(coachApiRateLimit).mockResolvedValue(null);
  vi.mocked(requireCSRFProtection).mockResolvedValue(null);
  vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
  vi.mocked(getClientById).mockResolvedValue(OWNED as never);
  vi.mocked(readInvitation).mockResolvedValue(READ);
  vi.mocked(sendInvitation).mockResolvedValue({ sent: true, invitation: READ });
});

describe("GET /api/clients/[id]/invitation (the Invite box's read)", () => {
  it("answers the client's invitation on the coach's calendar, read fresh every time", async () => {
    const res = await call("GET").response;

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ success: true, data: READ });
    // Any client of the coach's, an archived one too, as the old read did.
    expect(getClientById).toHaveBeenCalledWith(CLIENT_ID, true);
    expect(readInvitation).toHaveBeenCalledWith({ id: CLIENT_ID, coachId: COACH_ID, hasAccount: false });
  });

  it("whether the client has an account is their row's login", async () => {
    vi.mocked(getClientById).mockResolvedValue({ ...OWNED, userId: "user-73" } as never);
    await call("GET").response;
    expect(readInvitation).toHaveBeenCalledWith({ id: CLIENT_ID, coachId: COACH_ID, hasAccount: true });
  });

  it("the coach tier limits it first: the box opens as often as a coach likes, and none is refused at six", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(NextResponse.json({ error: "Too many requests" }, { status: 429 }));
    const res = await call("GET").response;
    expect(res.status).toBe(429);
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
  });

  it("no coach is 401, and the auth seam is handed the request", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    const { request, response } = call("GET");
    const res = await response;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(getClientById).not.toHaveBeenCalled();
  });

  it.each([
    ["no client", null],
    ["another coach's client", { ...OWNED, coachId: "coach-8" }],
  ])("%s is 404, alike, and nothing about it is read", async (_label, client) => {
    vi.mocked(getClientById).mockResolvedValue(client as never);
    const res = await call("GET").response;
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Client not found" });
    expect(readInvitation).not.toHaveBeenCalled();
  });

  it("a read that fails says so plainly and reaches Sentry", async () => {
    const fault = new Error("Failed to read the invitation: connection refused");
    vi.mocked(readInvitation).mockRejectedValue(fault);
    const res = await call("GET").response;
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Couldn't load the invitation." });
    expect(captureApiError).toHaveBeenCalledWith(fault, { route: "GET /api/clients/[id]/invitation" });
  });
});

describe("POST /api/clients/[id]/invitation (the Invite box's send)", () => {
  it("sends, records the send and answers the box's new read", async () => {
    const { request, response } = call("POST");
    const res = await response;

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ success: true, data: READ });
    expect(text).not.toMatch(TOKEN_SHAPE);
    expect(sendInvitation).toHaveBeenCalledWith(CLIENT_ID);
    expect(recordAuditEvent).toHaveBeenCalledWith({
      actorId: COACH_ID,
      actorRole: "trainer",
      action: "invitation.send",
      targetTable: "client_invitations",
      clientId: CLIENT_ID,
      request,
    });
  });

  it.each([
    ["the email didn't go", "email_failed", 502, "The email couldn't be sent. Try again."],
    ["it went and its row couldn't be written", "failed", 500, "Something went wrong. Try again."],
    ["the client has an account", "has_account", 409, "This client already has an account."],
    ["the client has no address", "no_email", 409, "This client has no email address."],
    ["the client went", "not_found", 404, "Client not found"],
  ] as const)("a send that wrote nothing because %s answers %s %i with its plain sentence, and records nothing", async (_label, reason, status, error) => {
    vi.mocked(sendInvitation).mockResolvedValue({ sent: false, reason });
    const res = await call("POST").response;
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ success: false, error });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("the rate limit runs first and CSRF second; either refusing stops everything", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(NextResponse.json({ error: "Too many requests" }, { status: 429 }));
    expect((await call("POST").response).status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();

    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect((await call("POST").response).status).toBe(403);
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it("no coach is 401, and nothing is sent", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    const res = await call("POST").response;
    expect(res.status).toBe(401);
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it("another coach's client is 404, and is sent nothing", async () => {
    vi.mocked(getClientById).mockResolvedValue({ ...OWNED, coachId: "coach-8" } as never);
    const res = await call("POST").response;
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Client not found" });
    expect(sendInvitation).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("a failure before the send says so plainly and reaches Sentry", async () => {
    const fault = new Error("Failed to fetch client");
    vi.mocked(getClientById).mockRejectedValue(fault);
    const res = await call("POST").response;
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Something went wrong. Try again." });
    expect(captureApiError).toHaveBeenCalledWith(fault, { route: "POST /api/clients/[id]/invitation" });
    expect(sendInvitation).not.toHaveBeenCalled();
  });
});
