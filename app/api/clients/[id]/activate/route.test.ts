import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn(),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/services/email-service", () => ({
  sendActivationEmail: vi.fn(),
}));

vi.mock("@/services/invitation-service", () => ({
  sendInvitationIfNeeded: vi.fn(),
}));

vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/services/client-start-service", () => ({
  recordClientStart: vi.fn(),
}));

vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

import { POST } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { sendActivationEmail } from "@/services/email-service";
import { sendInvitationIfNeeded } from "@/services/invitation-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { recordClientStart } from "@/services/client-start-service";

const COACH_ID = "coach-5";
const CLIENT_ID = "client-12";

const owned = {
  id: CLIENT_ID,
  coachId: COACH_ID,
  name: "Maya Okafor",
  email: "maya@example.com",
  currentWeight: 68.4,
  startDate: null,
};

/** One statement the route made through the service role. */
type Statement = {
  table: string;
  verb: "select" | "update";
  arg: unknown;
  filters: Array<[string, unknown]>;
};

let statements: Statement[] = [];
let updateError: { message: string } | null = null;

// Records every statement: the service role reads past every rule in the
// database, so a statement's filters are its whole scope. An update is awaited
// as the builder; a read ends in `.single()`.
function serviceRole(table: string) {
  const statement: Statement = { table, verb: "select", arg: undefined, filters: [] };
  statements.push(statement);
  const builder = {
    select: (columns: string) => {
      statement.verb = "select";
      statement.arg = columns;
      return builder;
    },
    update: (values: unknown) => {
      statement.verb = "update";
      statement.arg = values;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      statement.filters.push([column, value]);
      return builder;
    },
    single: () => {
      if (String(statement.arg).includes("coach:coach_id")) {
        return Promise.resolve({ data: { coach: { name: "Priya Natarajan" } }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected read of ${String(statement.arg)}` } });
    },
  };
  Object.defineProperty(builder, "then", {
    value: (resolve: (value: { error: typeof updateError }) => void) =>
      Promise.resolve({ error: updateError }).then(resolve),
  });
  return builder;
}

function activate(body: Record<string, unknown>) {
  const request = new NextRequest(`http://localhost:3000/api/clients/${CLIENT_ID}/activate`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return { request, response: POST(request, { params: Promise.resolve({ id: CLIENT_ID }) }) };
}

const BODY = {
  startDate: "2026-10-02",
  firstCheckInDue: "2026-10-09",
  welcomeMessage: "Welcome aboard, Maya.",
};

describe("POST /api/clients/[id]/activate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statements = [];
    updateError = null;
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue(owned as never);
    vi.mocked(supabaseAdmin.from).mockImplementation(serviceRole as never);
    vi.mocked(sendActivationEmail).mockResolvedValue({ success: true });
    vi.mocked(sendInvitationIfNeeded).mockResolvedValue("sent");
    vi.mocked(recordClientStart).mockResolvedValue(undefined);
  });

  describe("the whole coach chain runs before a row is read or written", () => {
    it("a rate-limited request stops at the limiter", async () => {
      vi.mocked(coachApiRateLimit).mockResolvedValue(
        NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 })
      );

      const res = await activate(BODY).response;

      expect(res.status).toBe(429);
      expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("a request the CSRF check refuses stops there", async () => {
      vi.mocked(requireCSRFProtection).mockResolvedValue(
        NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 })
      );

      const res = await activate(BODY).response;

      expect(res.status).toBe(403);
      expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("no coach is 401, and the auth seam is handed the request", async () => {
      vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

      const { request, response } = activate(BODY);
      const res = await response;

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
      expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
      expect(getClientById).not.toHaveBeenCalled();
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("a client that does not exist is 404", async () => {
      vi.mocked(getClientById).mockResolvedValue(null);

      const res = await activate(BODY).response;

      expect(res.status).toBe(404);
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("another coach's client is 403, and nothing about it is read, written or recorded", async () => {
      vi.mocked(getClientById).mockResolvedValue({ ...owned, coachId: "coach-8" } as never);

      const res = await activate(BODY).response;

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ success: false, error: "Forbidden" });
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
      expect(recordClientStart).not.toHaveBeenCalled();
      expect(recordAuditEvent).not.toHaveBeenCalled();
      expect(sendActivationEmail).not.toHaveBeenCalled();
      expect(sendInvitationIfNeeded).not.toHaveBeenCalled();
    });

    it("a client with no weight reading is 409", async () => {
      vi.mocked(getClientById).mockResolvedValue({ ...owned, currentWeight: undefined } as never);

      const res = await activate(BODY).response;

      expect(res.status).toBe(409);
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("an invalid body is 400", async () => {
      const res = await activate({ firstCheckInDue: "9 October" }).response;

      expect(res.status).toBe(400);
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });
  });

  it("activates through the service role, the update scoped to the client proved and to its coach", async () => {
    const res = await activate(BODY).response;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { activated: true, invitation: "sent" } });
    const update = statements.find((s) => s.verb === "update");
    expect(update).toEqual({
      table: "clients",
      verb: "update",
      arg: {
        onboarding_status: "active",
        updated_at: expect.any(String),
        next_check_in_due: "2026-10-09",
        welcome_message: "Welcome aboard, Maya.",
      },
      filters: [
        ["id", CLIENT_ID],
        ["coach_id", COACH_ID],
      ],
    });
    expect(recordClientStart).toHaveBeenCalledWith(CLIENT_ID, { startsOn: "2026-10-02" });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: COACH_ID, action: "client.activate", targetId: CLIENT_ID, clientId: CLIENT_ID })
    );
  });

  it("reads the coach's name for the activation email through the service role, scoped the same way", async () => {
    await activate(BODY).response;

    await vi.waitFor(() =>
      expect(sendActivationEmail).toHaveBeenCalledWith("maya@example.com", "Maya Okafor", "Priya Natarajan")
    );
    expect(statements.filter((s) => s.verb === "select")).toEqual([
      { table: "clients", verb: "select", arg: "coach:coach_id (name)", filters: [["id", CLIENT_ID], ["coach_id", COACH_ID]] },
    ]);
  });

  // D42: the invitation is the service's to decide (sendInvitationIfNeeded:
  // none for a client with an account or a link that still works), handed the
  // client the ownership check loaded, and awaited, so the answer says what
  // it did and the dialog can warn when it didn't send.
  it.each(["sent", "failed", "not_needed"] as const)(
    "awaits the client's invitation once the activation is written, and answers what it did (%s)",
    async (outcome) => {
      vi.mocked(getClientById).mockResolvedValue({ ...owned, userId: undefined } as never);
      vi.mocked(sendInvitationIfNeeded).mockResolvedValue(outcome);

      const res = await activate(BODY).response;

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { activated: true, invitation: outcome } });
      expect(sendInvitationIfNeeded).toHaveBeenCalledTimes(1);
      expect(sendInvitationIfNeeded).toHaveBeenCalledWith({ id: CLIENT_ID, email: "maya@example.com", userId: undefined });
      expect(vi.mocked(recordClientStart).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(sendInvitationIfNeeded).mock.invocationCallOrder[0]
      );
    }
  );

  it("hands the service the client's login and address, so a client with an account is sent nothing and a link goes to their address now", async () => {
    vi.mocked(getClientById).mockResolvedValue({ ...owned, userId: "user-73" } as never);
    vi.mocked(sendInvitationIfNeeded).mockResolvedValue("not_needed");

    const res = await activate(BODY).response;

    expect(await res.json()).toEqual({ success: true, data: { activated: true, invitation: "not_needed" } });
    expect(sendInvitationIfNeeded).toHaveBeenCalledWith({ id: CLIENT_ID, email: "maya@example.com", userId: "user-73" });
  });

  it("a failed update is a 500, and nothing after it runs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    updateError = { message: "connection reset" };

    const res = await activate(BODY).response;

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to activate client" });
    expect(recordClientStart).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(sendActivationEmail).not.toHaveBeenCalled();
    expect(sendInvitationIfNeeded).not.toHaveBeenCalled();
    expect(statements.filter((s) => s.verb === "select")).toEqual([]);
    expect(spy).toHaveBeenCalledWith("Supabase update error:", "connection reset");
    spy.mockRestore();
  });
});
