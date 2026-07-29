import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The real PhaseWriteError is imported via importOriginal below (the route uses
// `instanceof`, so a look-alike class would not match). That pulls the service
// module in for real, which reaches for Supabase env vars — stub the client.
vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));
vi.mock("@/services/client-phases-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/services/client-phases-service")
  >();
  return {
    PhaseWriteError: actual.PhaseWriteError,
    getClientPhases: vi.fn(),
    replaceClientPhases: vi.fn(),
    deleteClientPhase: vi.fn(),
  };
});
vi.mock("@/services/nutrition-plan-service", () => ({
  isNutritionStaleForPhases: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn(),
}));
// CLIENT_TODAY must stay DIFFERENT from validPut.startDate below. They were the
// same string once, and the "judges elapsed blocks against the CLIENT's today"
// assertion passed for the wrong reason: passing the coach's requested
// startDate instead of the client's today satisfied it just as well.
const CLIENT_TODAY = "2026-07-20";

vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn().mockResolvedValue("2026-07-20"),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getClientPhases,
  replaceClientPhases,
  deleteClientPhase,
  PhaseWriteError,
} from "@/services/client-phases-service";
import { isNutritionStaleForPhases } from "@/services/nutrition-plan-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { getClientTodayString } from "@/services/today-service";
import { GET, PUT, DELETE } from "./route";

const clientId = "client-1";
const routeParams = { params: Promise.resolve({ id: clientId }) };

const phase = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Cut 1",
  startsOn: "2026-08-01",
  endsOn: "2026-08-28",
  ratePerWeekKg: -0.5,
  dailyTargets: null,
};

const validPut = {
  startDate: "2026-08-01",
  phases: [{ name: "Cut 1", weeks: 4, ratePerWeekKg: -0.5 }],
};

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/clients/client-1/phases", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(coachApiRateLimit).mockResolvedValue(null);
  vi.mocked(requireCSRFProtection).mockResolvedValue(null);
  vi.mocked(requireCoachOwnsClient).mockResolvedValue({
    authorized: true,
    coachId: "coach-1",
  } as never);
  vi.mocked(getClientPhases).mockResolvedValue([phase] as never);
  vi.mocked(replaceClientPhases).mockResolvedValue([phase] as never);
  vi.mocked(deleteClientPhase).mockResolvedValue({
    deletedName: "Cut 1",
    shifted: [],
    phases: [],
  } as never);
  vi.mocked(isNutritionStaleForPhases).mockResolvedValue(false);
  vi.mocked(getClientTodayString).mockResolvedValue(CLIENT_TODAY);
});

describe("the §9/§10 auth chain", () => {
  it.each([
    ["GET", () => GET(req("GET"), routeParams)],
    ["PUT", () => PUT(req("PUT", validPut), routeParams)],
    ["DELETE", () => DELETE(req("DELETE", { phaseId: phase.id }), routeParams)],
  ])("%s rate-limits FIRST, before any work", async (_m, call) => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      new Response("rate limited", { status: 429 }) as never
    );
    const res = await call();
    expect(res.status).toBe(429);
    // Nothing was read, written, or even authenticated behind the limiter.
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
    expect(getClientPhases).not.toHaveBeenCalled();
    expect(replaceClientPhases).not.toHaveBeenCalled();
    expect(deleteClientPhase).not.toHaveBeenCalled();
  });

  it.each([
    ["PUT", () => PUT(req("PUT", validPut), routeParams)],
    ["DELETE", () => DELETE(req("DELETE", { phaseId: phase.id }), routeParams)],
  ])("%s enforces CSRF before touching data", async (_m, call) => {
    vi.mocked(requireCSRFProtection).mockResolvedValue(
      new Response("csrf", { status: 403 }) as never
    );
    const res = await call();
    expect(res.status).toBe(403);
    expect(replaceClientPhases).not.toHaveBeenCalled();
    expect(deleteClientPhase).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", () => GET(req("GET"), routeParams)],
    ["PUT", () => PUT(req("PUT", validPut), routeParams)],
    ["DELETE", () => DELETE(req("DELETE", { phaseId: phase.id }), routeParams)],
  ])("%s refuses a client the coach does not own", async (_m, call) => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: new Response("nope", { status: 404 }),
    } as never);

    const res = await call();
    expect(res.status).toBe(404);
    expect(getClientPhases).not.toHaveBeenCalled();
    expect(replaceClientPhases).not.toHaveBeenCalled();
    expect(deleteClientPhase).not.toHaveBeenCalled();
  });

  it("passes `request` to the auth helper so logs keep their context", async () => {
    const r = req("GET");
    await GET(r, routeParams);
    expect(requireCoachOwnsClient).toHaveBeenCalledWith(clientId, r);
  });
});

describe("GET", () => {
  it("returns the blocks plus a server-computed staleness flag", async () => {
    vi.mocked(isNutritionStaleForPhases).mockResolvedValue(true);

    const res = await GET(req("GET"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([phase]);
    // Session 3.6 reads this boolean rather than re-deriving the comparison —
    // and its custom-macros exemption — in the browser.
    expect(json.nutritionStale).toBe(true);
  });
});

describe("PUT", () => {
  it("400s on invalid input without writing", async () => {
    const res = await PUT(
      req("PUT", { startDate: "not-a-date", phases: [] }),
      routeParams
    );
    expect(res.status).toBe(400);
    expect(replaceClientPhases).not.toHaveBeenCalled();
  });

  it("rejects date pairs — the client sends LENGTHS only (invariant 6)", async () => {
    // .strict() means an unknown key is a 400, so overlapping windows cannot be
    // expressed at the boundary at all.
    const res = await PUT(
      req("PUT", {
        startDate: "2026-08-01",
        phases: [
          { name: "Cut 1", weeks: 4, ratePerWeekKg: -0.5, startsOn: "2026-08-01" },
        ],
      }),
      routeParams
    );
    expect(res.status).toBe(400);
    expect(replaceClientPhases).not.toHaveBeenCalled();
  });

  it("judges elapsed blocks against the CLIENT's today, not the server's", async () => {
    await PUT(req("PUT", validPut), routeParams);
    expect(getClientTodayString).toHaveBeenCalledWith(clientId);
    // The third argument is the CLIENT's today, never the coach's requested
    // startDate — the two are deliberately different strings here so that
    // confusing them fails.
    expect(replaceClientPhases).toHaveBeenCalledWith(
      clientId,
      expect.objectContaining({ startDate: "2026-08-01" }),
      CLIENT_TODAY
    );
  });

  it("surfaces an elapsed-block refusal as its own status, not a 500", async () => {
    vi.mocked(replaceClientPhases).mockRejectedValue(
      new PhaseWriteError('"Cut 1" has already finished and cannot be moved', 422)
    );

    const res = await PUT(req("PUT", validPut), routeParams);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error).toContain("Cut 1");
  });

  it("audits the write after it succeeds", async () => {
    await PUT(req("PUT", validPut), routeParams);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "coach-1",
        action: "phase.update",
        targetTable: "client_phases",
        clientId,
      })
    );
  });

  it("does NOT audit when the write failed", async () => {
    vi.mocked(replaceClientPhases).mockRejectedValue(new Error("boom"));
    await PUT(req("PUT", validPut), routeParams);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("returns the blocks whose dates shifted, for the confirm dialog", async () => {
    vi.mocked(deleteClientPhase).mockResolvedValue({
      deletedName: "Cut 1",
      shifted: [
        { id: "p2", name: "Cut 2", startsOn: "2026-08-01", endsOn: "2026-08-28" },
      ],
      phases: [],
    } as never);

    const res = await DELETE(req("DELETE", { phaseId: phase.id }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deletedName).toBe("Cut 1");
    expect(json.data.shifted[0].name).toBe("Cut 2");
  });

  it("400s on a non-uuid phaseId without touching the service", async () => {
    const res = await DELETE(req("DELETE", { phaseId: "nope" }), routeParams);
    expect(res.status).toBe(400);
    expect(deleteClientPhase).not.toHaveBeenCalled();
  });

  it("judges elapsed blocks against the CLIENT's today, not the server's", async () => {
    // The PUT twin of this test existed; DELETE's did not, and the omission
    // survived a mutation: swapping `getClientTodayString(clientId)` for a
    // server-side `new Date()` left the whole file green. A coach whose server
    // has not yet rolled over to the client's date could then delete a block
    // the client has already lived through.
    await DELETE(req("DELETE", { phaseId: phase.id }), routeParams);

    expect(getClientTodayString).toHaveBeenCalledWith(clientId);
    expect(deleteClientPhase).toHaveBeenCalledWith(
      clientId,
      phase.id,
      CLIENT_TODAY
    );
  });
});

describe("invariant 7 — blocks save independently of the goal", () => {
  it("this route never imports updateGoals", async () => {
    // A block edit must not mint a goal version: updateGoals supersedes-and-
    // inserts on every call, so renaming a block would create a new goal row.
    // Asserted structurally because the coupling would be silent at runtime.
    const [fs, path] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const src = await fs.readFile(
      path.join(process.cwd(), "app/api/clients/[id]/phases/route.ts"),
      "utf8"
    );
    // Comments are stripped FIRST. The route's own docstring states this rule,
    // so a raw substring match fails on the prose that documents it — and the
    // obvious "fix" is to delete that prose, which loses the explanation while
    // keeping the test green. The invariant is about imports and calls.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toContain("updateGoals");
    expect(code).not.toContain("client-goals-service");
  });
});
