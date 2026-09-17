import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/client-blocks-service", async () => {
  // As above: the route imports the class alone, and the real module loads
  // supabase-admin. The sentence comes from the constant, never a copy of it.
  const { BLOCKS_UNREADABLE } = await import("@/lib/constants");
  return {
    BlocksUnreadableError: class BlocksUnreadableError extends Error {
      constructor() {
        super(BLOCKS_UNREADABLE);
      }
    },
  };
});

vi.mock("@/services/training-service", () => ({
  getTrainingPlanById: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn().mockResolvedValue("coach-1"),
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/library-placement-service", () => ({
  placePlanOnCalendar: vi.fn(),
  placeSessionOnCalendar: vi.fn(),
  placeInlineEditedPlanOnCalendar: vi.fn(),
  // The route branches on this class; a plain mock would leave `instanceof`
  // comparing against undefined.
  PlacementSupersedeError: class PlacementSupersedeError extends Error {},
}));

vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

// The one answer to "from which day may a program start?" — keyed on a logged
// WORKOUT alone; its own rules are proved in services/event-deletion-floor.test.ts.
vi.mock("@/services/event-deletion-floor", () => ({
  resolveEventDeletionFloor: vi.fn(),
}));

vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getClientById } from "@/services/client-service";
import {
  placePlanOnCalendar,
  placeInlineEditedPlanOnCalendar,
} from "@/services/library-placement-service";
import { getClientTodayString } from "@/services/today-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { PlacementSupersedeError } from "@/services/library-placement-service";
import { BlocksUnreadableError } from "@/services/client-blocks-service";
import { BLOCKS_UNREADABLE } from "@/lib/constants";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";
import { POST } from "./route";

const clientId = "client-1";
const savedPlanId = "11111111-1111-4111-8111-111111111111";

const inlinePlanBody = {
  name: "Edited PPL",
  sessions: [
    {
      name: "Push",
      orderIndex: 0,
      isRest: false,
      groups: [{ ...STRAIGHT_SETS, exercises: [{ name: "Bench", sets: 3 }] }],
    },
  ],
};

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/clients/${clientId}/training/place-from-library`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

async function callRoute(body: Record<string, unknown>) {
  return POST(makeRequest(body), {
    params: Promise.resolve({ id: clientId }),
  });
}

// Fixed past dates: the guard compares request input against the mocked
// client-local today, so assertions can never collide with the host clock.
// The client's today is 15 Jan; the floor is 15 Jan until a test says the
// client has logged today, when it is 16 Jan.
describe("POST /api/clients/[id]/training/place-from-library start-date guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientById).mockResolvedValue({
      id: clientId,
      coachId: "coach-1",
      name: "Chloe",
    } as never);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-01-15");
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-01-15");
    vi.mocked(placePlanOnCalendar).mockResolvedValue({
      planId: "plan-1",
      sessionsCreated: 3,
      eventsCreated: 12,
    });
  });

  it("rejects a start date before the client's local today", async () => {
    const res = await callRoute({
      type: "plan",
      savedPlanId,
      startDate: "2026-01-14",
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe(
      "Start date 2026-01-14 has already passed for this client (their local date is 2026-01-15)."
    );
    expect(getClientTodayString).toHaveBeenCalledWith(clientId);
    expect(placePlanOnCalendar).not.toHaveBeenCalled();
  });

  it("allows a start date equal to the client's local today", async () => {
    const res = await callRoute({
      type: "plan",
      savedPlanId,
      startDate: "2026-01-15",
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(placePlanOnCalendar).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-01-15",
        clientId,
      })
    );
  });

  it("refuses a start on a day the client has already logged, naming them and the first day a plan can start", async () => {
    // The floor moved to tomorrow: the client logged a workout today. The old
    // warn-and-override wrote the program's first session beside the
    // completed one, and the check-in counted the pair as a missed session.
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-01-16");
    const res = await callRoute({ type: "plan", savedPlanId, startDate: "2026-01-15" });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Chloe has already logged 15 Jan. A plan can start from 16 Jan.");
    // Judged with the CLIENT's today — the same anchor the past-date guard uses.
    expect(resolveEventDeletionFloor).toHaveBeenCalledWith(clientId, "2026-01-15");
    expect(placePlanOnCalendar).not.toHaveBeenCalled();
  });

  it("allows a start on the floor itself", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-01-16");
    const res = await callRoute({ type: "plan", savedPlanId, startDate: "2026-01-16" });

    expect(res.status).toBe(200);
    expect(placePlanOnCalendar).toHaveBeenCalledTimes(1);
  });

  it("has no override: a startAnyway flag changes nothing", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-01-16");
    const res = await callRoute({
      type: "plan",
      savedPlanId,
      startDate: "2026-01-15",
      startAnyway: true,
    });

    expect(res.status).toBe(400);
    expect(placePlanOnCalendar).not.toHaveBeenCalled();
  });

  it("allows a future start date", async () => {
    const res = await callRoute({
      type: "plan",
      savedPlanId,
      startDate: "2026-01-20",
    });

    expect(res.status).toBe(200);
    expect(placePlanOnCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-01-20" })
    );
  });
});

describe("POST /api/clients/[id]/training/place-from-library inline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientById).mockResolvedValue({
      id: clientId,
      coachId: "coach-1",
      name: "Chloe",
    } as never);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-01-15");
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-01-15");
    vi.mocked(placePlanOnCalendar).mockResolvedValue({
      planId: "plan-1",
      sessionsCreated: 3,
      eventsCreated: 12,
    });
    vi.mocked(placeInlineEditedPlanOnCalendar).mockResolvedValue({
      planId: "inline-plan-1",
      sessionsCreated: 1,
      eventsCreated: 5,
    });
  });

  it("places an edited working copy inline and does not touch the saved-plan path", async () => {
    const res = await callRoute({
      type: "inline",
      plan: inlinePlanBody,
      startDate: "2026-01-20",
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.planId).toBe("inline-plan-1");
    expect(placeInlineEditedPlanOnCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ clientId, startDate: "2026-01-20" }),
    );
    expect(placePlanOnCalendar).not.toHaveBeenCalled();
  });

  it("re-runs the past-date guard on the inline branch", async () => {
    const res = await callRoute({
      type: "inline",
      plan: inlinePlanBody,
      startDate: "2026-01-14",
    });

    expect(res.status).toBe(400);
    expect(placeInlineEditedPlanOnCalendar).not.toHaveBeenCalled();
  });

  it("re-runs the floor guard on the inline branch", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-01-16");
    const res = await callRoute({
      type: "inline",
      plan: inlinePlanBody,
      startDate: "2026-01-15",
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Chloe has already logged 15 Jan. A plan can start from 16 Jan.");
    expect(placeInlineEditedPlanOnCalendar).not.toHaveBeenCalled();
  });
});

describe("the placement supersedes the earlier programs (migration 167)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientById).mockResolvedValue({
      id: clientId,
      coachId: "coach-1",
      name: "Chloe",
    } as never);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-01-15");
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-01-15");
  });

  it("a supersede failure is a 500 carrying the service's own sentence — the program IS on the calendar", async () => {
    vi.mocked(placePlanOnCalendar).mockRejectedValue(
      new PlacementSupersedeError(
        "The program is on the calendar, but the previous program's sessions from 2026-01-15 could not be removed (boom). Delete them from the calendar, or place the program again."
      )
    );

    const res = await callRoute({ type: "plan", savedPlanId, startDate: "2026-01-15" });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/^The program is on the calendar/);
  });

  it("a blocks read that failed refuses the placement with its own sentence", async () => {
    // Nothing is written: the window is resolved first, and a program laid
    // without the block's end would run straight through the block.
    vi.mocked(placePlanOnCalendar).mockRejectedValue(new BlocksUnreadableError());

    const res = await callRoute({ type: "plan", savedPlanId, startDate: "2026-01-15" });
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toBe(BLOCKS_UNREADABLE);
  });
});
