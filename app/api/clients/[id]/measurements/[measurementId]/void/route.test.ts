import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  MeasurementNotFoundError,
  MeasurementStateError,
} from "@/lib/measurements/edit-errors";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn() }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn() }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/measurement-edits-service", () => ({ voidMeasurement: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn() }));

import { POST } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { voidMeasurement } from "@/services/measurement-edits-service";
import { recordAuditEvent } from "@/services/audit-log-service";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "22222222-2222-4222-8222-222222222222";

function makeRequest(body?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/clients/${CLIENT_ID}/measurements/${ROW_ID}/void`,
    body === undefined
      ? { method: "POST" }
      : { method: "POST", body, headers: { "Content-Type": "application/json" } }
  );
}

const params = Promise.resolve({ id: CLIENT_ID, measurementId: ROW_ID });

const RESULT = { id: ROW_ID, metricKey: "weight" as const, sourceId: "ci-1", energy: "recomputed" as const };

describe("POST /api/clients/[id]/measurements/[measurementId]/void", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-1" });
    vi.mocked(voidMeasurement).mockResolvedValue(RESULT);
    vi.mocked(recordAuditEvent).mockResolvedValue(undefined);
  });

  it("removes the reading with NO body — the coach UI sends none", async () => {
    const request = makeRequest();
    const response = await POST(request, { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: RESULT });
    expect(voidMeasurement).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      measurementId: ROW_ID,
      actor: "coach-1",
      reason: undefined,
    });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith(CLIENT_ID, request);
  });

  it("passes a reason through, and refuses one over the limit or an unknown key", async () => {
    await POST(makeRequest(JSON.stringify({ reason: "typo" })), { params });
    expect(voidMeasurement).toHaveBeenCalledWith(expect.objectContaining({ reason: "typo" }));

    expect((await POST(makeRequest(JSON.stringify({ reason: "x".repeat(201) })), { params })).status).toBe(400);
    expect((await POST(makeRequest(JSON.stringify({ why: "typo" })), { params })).status).toBe(400);
    expect((await POST(makeRequest("not json"), { params })).status).toBe(400);
    expect(voidMeasurement).toHaveBeenCalledTimes(1);
  });

  it("audits the removal with the metric only — never the value", async () => {
    await POST(makeRequest(), { params });

    const event = vi.mocked(recordAuditEvent).mock.calls[0][0];
    expect(event).toMatchObject({
      actorId: "coach-1",
      action: "measurement.void",
      targetTable: "client_measurements",
      targetId: ROW_ID,
      clientId: CLIENT_ID,
      metadata: { metricKey: "weight" },
    });
    expect(Object.keys(event.metadata ?? {})).toEqual(["metricKey"]);
  });

  it("rate-limits first, then CSRF, before auth or any write", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 })
    );
    expect((await POST(makeRequest(), { params })).status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();

    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(
      NextResponse.json({ error: "Invalid origin" }, { status: 403 })
    );
    expect((await POST(makeRequest(), { params })).status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
    expect(voidMeasurement).not.toHaveBeenCalled();
  });

  it("refuses a client the coach does not own, and a malformed reading id, writing nothing", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await POST(makeRequest(), { params })).status).toBe(404);

    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-1" });
    const malformed = await POST(makeRequest(), {
      params: Promise.resolve({ id: CLIENT_ID, measurementId: "nope" }),
    });
    expect(malformed.status).toBe(404);
    expect(voidMeasurement).not.toHaveBeenCalled();
  });

  it("maps the refusals: a foreign row 404, a double void or the last weight 409", async () => {
    vi.mocked(voidMeasurement).mockRejectedValue(new MeasurementNotFoundError());
    expect((await POST(makeRequest(), { params })).status).toBe(404);

    vi.mocked(voidMeasurement).mockRejectedValue(
      new MeasurementStateError("A client's only weight reading can't be removed. Correct it instead.")
    );
    const conflict = await POST(makeRequest(), { params });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toMatch(/Correct it instead/);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("500s on an unexpected failure", async () => {
    vi.mocked(voidMeasurement).mockRejectedValue(new Error("connection reset"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await POST(makeRequest(), { params })).status).toBe(500);
    consoleError.mockRestore();
  });
});
