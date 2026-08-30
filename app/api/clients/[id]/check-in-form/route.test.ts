import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));
// The service module reaches supabaseAdmin at import, which throws without
// env vars, so the factory declares its own CheckInFormError rather than
// pulling the real one in via importOriginal. The route instanceof-checks the
// class it imports and the test throws the class it imports — the same one.
vi.mock("@/services/check-in-form-service", () => ({
  CheckInFormError: class CheckInFormError extends Error {},
  getCoachClientCheckInForm: vi.fn(),
  saveClientCheckInForm: vi.fn(),
}));
vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));

import { GET, PUT } from "./route";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  CheckInFormError,
  getCoachClientCheckInForm,
  saveClientCheckInForm,
} from "@/services/check-in-form-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

const params = Promise.resolve({ id: "client-1" });

const getReq = () =>
  new NextRequest("http://localhost:3000/api/clients/client-1/check-in-form");

const putReq = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/clients/client-1/check-in-form", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const validBody = {
  fields: ["weight", "notes"],
  questions: [{ questionId: "00000001-0000-4000-8000-000000000000", enabled: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachOwnsClient).mockResolvedValue({
    authorized: true,
    coachId: "coach-1",
  });
  vi.mocked(getCoachClientCheckInForm).mockResolvedValue({ fields: [], questions: [] });
  vi.mocked(saveClientCheckInForm).mockResolvedValue("form-1");
  vi.mocked(requireCSRFProtection).mockResolvedValue(null);
});

describe("GET /api/clients/[id]/check-in-form", () => {
  it("returns the editor's view of the form", async () => {
    vi.mocked(getCoachClientCheckInForm).mockResolvedValueOnce({
      fields: ["weight"],
      questions: [{ id: "q-a", prompt: "How was sleep?", enabled: false }],
    });

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.fields).toEqual(["weight"]);
    expect(body.data.questions[0].enabled).toBe(false);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("404s a client this coach does not own, without reading the form", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const res = await GET(getReq(), { params });

    expect(res.status).toBe(404);
    expect(getCoachClientCheckInForm).not.toHaveBeenCalled();
  });

  it("passes the request to the auth helper so failures log route + hashed IP", async () => {
    await GET(getReq(), { params });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-1", expect.anything());
  });
});

describe("PUT /api/clients/[id]/check-in-form", () => {
  it("saves, re-reads and audits", async () => {
    const res = await PUT(putReq(validBody), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(saveClientCheckInForm).toHaveBeenCalledWith("coach-1", "client-1", validBody);
    expect(body.success).toBe(true);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.CHECK_IN_FORM_UPDATE,
        actorId: "coach-1",
        clientId: "client-1",
        targetTable: "check_in_forms",
      })
    );
  });

  it("refuses without CSRF, before auth or any write", async () => {
    vi.mocked(requireCSRFProtection).mockResolvedValueOnce(
      NextResponse.json({ error: "CSRF" }, { status: 403 })
    );

    const res = await PUT(putReq(validBody), { params });

    expect(res.status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
    expect(saveClientCheckInForm).not.toHaveBeenCalled();
  });

  it("404s a foreign client before validating or writing", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const res = await PUT(putReq(validBody), { params });

    expect(res.status).toBe(404);
    expect(saveClientCheckInForm).not.toHaveBeenCalled();
  });

  it("400s an unknown field key without writing", async () => {
    const res = await PUT(putReq({ fields: ["mood"], questions: [] }), { params });

    expect(res.status).toBe(400);
    expect(saveClientCheckInForm).not.toHaveBeenCalled();
  });

  it("422s the RPC's own refusal with its message, not a 500", async () => {
    vi.mocked(saveClientCheckInForm).mockRejectedValueOnce(
      new CheckInFormError("A question on this form is not one of yours.")
    );

    const res = await PUT(putReq(validBody), { params });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe("A question on this form is not one of yours.");
  });

  it("500s an unexpected failure and does not audit it", async () => {
    vi.mocked(saveClientCheckInForm).mockRejectedValueOnce(new Error("deadlock"));

    const res = await PUT(putReq(validBody), { params });

    expect(res.status).toBe(500);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
