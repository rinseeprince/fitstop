import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/services/client-service", () => ({ getClientById: vi.fn() }));

// The route imports the class alone, to say why it refused; the real module
// loads supabase-admin. The sentence comes from the constant, never a copy.
vi.mock("@/services/client-blocks-service", async () => {
  const { BLOCKS_UNREADABLE } = await import("@/lib/constants");
  return {
    BlocksUnreadableError: class BlocksUnreadableError extends Error {
      constructor() {
        super(BLOCKS_UNREADABLE);
      }
    },
  };
});

// The refusals carry the sentences the service gives them, and the route
// relays each one, so these classes say what the service's say.
vi.mock("@/services/plan-edit-service", () => {
  class PlanEditNotFoundError extends Error {
    constructor() {
      super("Plan not found");
    }
  }
  class PlanEndedError extends Error {
    constructor() {
      super("This plan has ended and can't be edited.");
    }
  }
  class PlanEditStaleError extends Error {
    constructor() {
      super("This plan changed while you were editing");
    }
  }
  class PlanEditInvalidError extends Error {}
  return {
    getPlanForEditing: vi.fn(),
    savePlanEdit: vi.fn(),
    PlanEditNotFoundError,
    PlanEndedError,
    PlanEditStaleError,
    PlanEditInvalidError,
  };
});

vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedCoachId: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn() }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn() }));

import { GET, PUT } from "./route";
import { getClientById } from "@/services/client-service";
import {
  getPlanForEditing,
  savePlanEdit,
  PlanEditInvalidError,
  PlanEditNotFoundError,
  PlanEditStaleError,
  PlanEndedError,
  type PlanForEditing,
} from "@/services/plan-edit-service";
import { BlocksUnreadableError } from "@/services/client-blocks-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { BLOCKS_UNREADABLE } from "@/lib/constants";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";

const CLIENT_ID = "c0000000-0000-4000-8000-000000000001";
const PLAN_ID = "a0000000-0000-4000-8000-000000000001";
const COACH_ID = "coach-1";
const EDIT_URL = `http://localhost/api/clients/${CLIENT_ID}/training/${PLAN_ID}/edit`;

const params = (planId = PLAN_ID) => ({ params: Promise.resolve({ id: CLIENT_ID, planId }) });

const makeGet = () => new NextRequest(EDIT_URL);

function makePut(body: unknown): NextRequest {
  return new NextRequest(EDIT_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const planForEditing: PlanForEditing = {
  plan: {
    id: PLAN_ID,
    name: "Block A",
    splitType: "Strength",
    effectiveFrom: "2026-09-07",
    effectiveUntil: "2026-09-20",
  },
  clientToday: "2026-09-10",
  firstEditableDate: "2026-09-10",
  limit: { endsOn: "2026-09-24", source: "next_block" },
  days: [
    { date: "2026-09-07", sessions: [] },
    {
      date: "2026-09-08",
      sessions: [
        {
          eventId: "e0000000-0000-4000-8000-000000000001",
          name: "Push",
          focus: null,
          estimatedDurationMinutes: 60,
          notes: null,
          calorieSurplusPercentage: 10,
          groups: [],
        },
      ],
    },
  ],
  version: "eyJmcm9tIjoiMjAyNi0wOS0xMCJ9",
};

// One whole week, the fewest days a save carries: two sessions on its first
// day, rest after.
const push = {
  eventId: "e0000000-0000-4000-8000-000000000001",
  name: "Push",
  groups: [{ ...STRAIGHT_SETS, exercises: [{ name: "Bench press", sets: 3 }] }],
};
const run = { eventId: null, name: "Run", groups: [] };
const days = Array.from({ length: 7 }, (_, i) => ({ sessions: i === 0 ? [push, run] : [] }));
const validBody = {
  days,
  plan: { name: "Block A", splitType: "Strength" },
  version: planForEditing.version,
};

const saved = { firstDay: "2026-09-10", lastDay: "2026-09-20", sessionsWritten: 3 };

describe("GET /api/clients/[id]/training/[planId]/edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID, coachId: COACH_ID } as never);
    vi.mocked(getPlanForEditing).mockResolvedValue(planForEditing);
  });

  it("returns the plan as the editor opens it", async () => {
    const request = makeGet();
    const response = await GET(request, params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: planForEditing });
    expect(getPlanForEditing).toHaveBeenCalledWith(CLIENT_ID, PLAN_ID);
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
    expect(requireCSRFProtection).not.toHaveBeenCalled();
  });

  it("rate-limits before anything else", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    );

    expect((await GET(makeGet(), params())).status).toBe(429);
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
    expect(getPlanForEditing).not.toHaveBeenCalled();
  });

  it("401s without a coach session", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    expect((await GET(makeGet(), params())).status).toBe(401);
    expect(getPlanForEditing).not.toHaveBeenCalled();
  });

  it("403s a client that is not the coach's", async () => {
    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID, coachId: "coach-2" } as never);
    expect((await GET(makeGet(), params())).status).toBe(403);

    vi.mocked(getClientById).mockResolvedValue(null);
    expect((await GET(makeGet(), params())).status).toBe(403);
    expect(getPlanForEditing).not.toHaveBeenCalled();
  });

  it("404s a plan id that is not a uuid, before any read", async () => {
    const response = await GET(makeGet(), params("not-a-plan"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Plan not found" });
    expect(getPlanForEditing).not.toHaveBeenCalled();
  });

  it("404s a plan the client-scoped read does not find", async () => {
    vi.mocked(getPlanForEditing).mockResolvedValue(null);

    const response = await GET(makeGet(), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Plan not found" });
  });

  it("404s an ended plan with the service's sentence", async () => {
    vi.mocked(getPlanForEditing).mockRejectedValue(new PlanEndedError());

    const response = await GET(makeGet(), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "This plan has ended and can't be edited." });
  });

  // The editor's limit is the block's end, so without the blocks it cannot say
  // which days belong to the plan: it refuses to open rather than offer days
  // past the block.
  it("503s when the client's blocks can't be read, with the same sentence as a refused placement", async () => {
    vi.mocked(getPlanForEditing).mockRejectedValue(new BlocksUnreadableError());

    const response = await GET(makeGet(), params());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: BLOCKS_UNREADABLE });
  });

  it("500s an unexpected failure without its text", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getPlanForEditing).mockRejectedValue(
      new Error("Failed to fetch the plan's calendar: canceling statement due to statement timeout"),
    );

    const response = await GET(makeGet(), params());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to load plan" });
    consoleError.mockRestore();
  });
});

describe("PUT /api/clients/[id]/training/[planId]/edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID, coachId: COACH_ID } as never);
    vi.mocked(savePlanEdit).mockResolvedValue(saved);
    vi.mocked(recordAuditEvent).mockResolvedValue(undefined);
  });

  it("saves the grid and answers the standard envelope", async () => {
    const request = makePut(validBody);
    const response = await PUT(request, params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: saved });
    expect(savePlanEdit).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      coachId: COACH_ID,
      planId: PLAN_ID,
      days,
      name: "Block A",
      splitType: "Strength",
      version: planForEditing.version,
    });
  });

  it("consults the rate limit and CSRF on the request", async () => {
    const request = makePut(validBody);
    await PUT(request, params());

    expect(coachApiRateLimit).toHaveBeenCalledWith(request);
    expect(requireCSRFProtection).toHaveBeenCalledWith(request);
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
  });

  it("rate-limits first and checks CSRF second, before auth or any write", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    );
    expect((await PUT(makePut(validBody), params())).status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();

    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(
      NextResponse.json({ error: "Invalid origin" }, { status: 403 }),
    );
    expect((await PUT(makePut(validBody), params())).status).toBe(403);
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
    expect(savePlanEdit).not.toHaveBeenCalled();
  });

  it("records the edit in the audit log with the days it wrote", async () => {
    const request = makePut(validBody);
    await PUT(request, params());

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledWith({
      actorId: COACH_ID,
      actorRole: "trainer",
      action: "training_plan.edit",
      targetTable: "training_plans",
      targetId: PLAN_ID,
      clientId: CLIENT_ID,
      metadata: { firstDay: "2026-09-10", lastDay: "2026-09-20", sessionsWritten: 3 },
      request,
    });
  });

  it("passes a plan with no focus as null", async () => {
    await PUT(makePut({ ...validBody, plan: { name: "Block A" } }), params());

    expect(savePlanEdit).toHaveBeenCalledWith(expect.objectContaining({ splitType: null }));
  });

  it("401s without a coach session", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    expect((await PUT(makePut(validBody), params())).status).toBe(401);
    expect(savePlanEdit).not.toHaveBeenCalled();
  });

  it("403s a client that is not the coach's", async () => {
    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID, coachId: "coach-2" } as never);
    expect((await PUT(makePut(validBody), params())).status).toBe(403);

    vi.mocked(getClientById).mockResolvedValue(null);
    expect((await PUT(makePut(validBody), params())).status).toBe(403);
    expect(savePlanEdit).not.toHaveBeenCalled();
  });

  it("404s a plan id that is not a uuid, before any write", async () => {
    const response = await PUT(makePut(validBody), params("not-a-plan"));

    expect(response.status).toBe(404);
    expect(savePlanEdit).not.toHaveBeenCalled();
  });

  it("400s a body the schema refuses, before any write", async () => {
    const { version: _version, ...noVersion } = validBody;

    for (const body of [
      noVersion,
      { ...validBody, version: "" },
      { ...validBody, days: days.slice(0, 6) },
      { ...validBody, days: [{ sessions: [{ ...push, eventId: "not-an-id" }] }, ...days.slice(1)] },
      { ...validBody, plan: { name: "" } },
    ]) {
      const response = await PUT(makePut(body), params());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid input" });
    }
    expect(savePlanEdit).not.toHaveBeenCalled();
  });

  it("409s a save refused as stale, with the service's sentence, and audits nothing", async () => {
    vi.mocked(savePlanEdit).mockRejectedValue(new PlanEditStaleError());

    const response = await PUT(makePut(validBody), params());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This plan changed while you were editing" });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("404s a save whose plan is gone, and audits nothing", async () => {
    vi.mocked(savePlanEdit).mockRejectedValue(new PlanEditNotFoundError());

    const response = await PUT(makePut(validBody), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Plan not found" });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("400s a save the service refuses as malformed, with its sentence", async () => {
    vi.mocked(savePlanEdit).mockRejectedValue(new PlanEditInvalidError("The plan must be whole weeks"));

    const response = await PUT(makePut(validBody), params());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "The plan must be whole weeks" });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("503s a save whose blocks read failed, with the same sentence, and audits nothing", async () => {
    vi.mocked(savePlanEdit).mockRejectedValue(new BlocksUnreadableError());

    const response = await PUT(makePut(validBody), params());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: BLOCKS_UNREADABLE });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("500s an unexpected failure without echoing its text", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(savePlanEdit).mockRejectedValue(
      new Error(
        'Failed to save the plan: duplicate key value violates unique constraint "training_events_one_scheduled_per_day"',
      ),
    );

    const response = await PUT(makePut(validBody), params());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Failed to save plan changes" });
    expect(JSON.stringify(body)).not.toContain("duplicate key");
    expect(recordAuditEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
