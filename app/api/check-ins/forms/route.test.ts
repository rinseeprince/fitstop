import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachAuth: vi.fn() }));
// See the check-in-form route test: the real service module reaches
// supabaseAdmin at import and throws without env vars.
vi.mock("@/services/check-in-form-service", () => ({
  CheckInFormError: class CheckInFormError extends Error {},
  listCheckInFormTemplates: vi.fn(),
  createCheckInFormTemplate: vi.fn(),
}));
vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));

import { GET, POST } from "./route";
import { requireCoachAuth } from "@/lib/require-coach-auth";
import {
  createCheckInFormTemplate,
  listCheckInFormTemplates,
} from "@/services/check-in-form-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

const url = "http://localhost:3000/api/check-ins/forms";
const getReq = () => new NextRequest(url);
const postReq = (body: unknown) =>
  new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const template = {
  id: "form-2",
  name: "Fortnightly",
  createdAt: "2026-08-01T00:00:00Z",
  fields: ["weight"],
  questions: [{ id: "q-a", prompt: "How was sleep?", enabled: true }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachAuth).mockResolvedValue({ authorized: true, coachId: "coach-1" });
  vi.mocked(listCheckInFormTemplates).mockResolvedValue([template]);
  vi.mocked(createCheckInFormTemplate).mockResolvedValue("form-2");
});

describe("GET /api/check-ins/forms", () => {
  it("returns each template's WHOLE content, because applying one is client-side", async () => {
    // There is no server-side apply route: picking a template replaces the
    // sheet's editor state and the coach commits it through the client-form
    // PUT. That only works if the list carries fields and questions.
    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.templates[0].fields).toEqual(["weight"]);
    expect(body.data.templates[0].questions).toHaveLength(1);
    expect(listCheckInFormTemplates).toHaveBeenCalledWith("coach-1");
  });

  it("401s without a coach", async () => {
    vi.mocked(requireCoachAuth).mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(listCheckInFormTemplates).not.toHaveBeenCalled();
  });
});

describe("POST /api/check-ins/forms", () => {
  const validBody = { name: "Fortnightly", fields: ["weight"], questions: [] };

  it("creates the template and audits it with a null tenant", async () => {
    const res = await POST(postReq(validBody));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.templateId).toBe("form-2");
    expect(createCheckInFormTemplate).toHaveBeenCalledWith("coach-1", "Fortnightly", {
      fields: ["weight"],
      questions: [],
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.CHECK_IN_FORM_TEMPLATE_CREATE,
        actorId: "coach-1",
        targetId: "form-2",
        // A template belongs to the coach, not to a client.
        clientId: null,
      })
    );
  });

  it("400s a nameless template without writing", async () => {
    const res = await POST(postReq({ fields: [], questions: [] }));

    expect(res.status).toBe(400);
    expect(createCheckInFormTemplate).not.toHaveBeenCalled();
  });

  it("400s a duplicate question id", async () => {
    const id = "00000001-0000-4000-8000-000000000000";
    const res = await POST(
      postReq({
        name: "Dupes",
        fields: [],
        questions: [
          { questionId: id, enabled: true },
          { questionId: id, enabled: true },
        ],
      })
    );

    expect(res.status).toBe(400);
    expect(createCheckInFormTemplate).not.toHaveBeenCalled();
  });
});
