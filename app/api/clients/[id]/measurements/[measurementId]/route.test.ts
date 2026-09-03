import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  MeasurementNotFoundError,
  MeasurementStateError,
  MeasurementValueError,
} from "@/lib/measurements/edit-errors";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn() }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn() }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/measurement-edits-service", () => ({ updateMeasurement: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn() }));

import { PATCH } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { updateMeasurement } from "@/services/measurement-edits-service";
import { recordAuditEvent } from "@/services/audit-log-service";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "22222222-2222-4222-8222-222222222222";

function makeRequest(body: unknown = { value: 90 }): NextRequest {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/measurements/${ROW_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = Promise.resolve({ id: CLIENT_ID, measurementId: ROW_ID });

// The row edited in place keeps its id: the result names the same row the
// request did.
const RESULT = {
  id: ROW_ID,
  metricKey: "weight" as const,
  sourceId: "ci-1",
  date: "2026-08-14",
  updated: true,
  energy: "recomputed" as const,
};

describe("PATCH /api/clients/[id]/measurements/[measurementId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-1" });
    vi.mocked(updateMeasurement).mockResolvedValue(RESULT);
    vi.mocked(recordAuditEvent).mockResolvedValue(undefined);
  });

  it("edits the reading as the coach and answers the standard envelope", async () => {
    const request = makeRequest({ value: 90 });
    const response = await PATCH(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { id: ROW_ID, metricKey: "weight", sourceId: "ci-1", updated: true, energy: "recomputed" },
    });
    // No actor reaches the service: the RPC takes none, the audit row carries it.
    expect(updateMeasurement).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      measurementId: ROW_ID,
      value: 90,
    });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith(CLIENT_ID, request);
  });

  it("audits a written edit with the metric and the date — never the value", async () => {
    await PATCH(makeRequest({ value: 90 }), { params });

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(recordAuditEvent).mock.calls[0][0];
    expect(event).toMatchObject({
      actorId: "coach-1",
      actorRole: "trainer",
      action: "measurement.update",
      targetTable: "client_measurements",
      targetId: ROW_ID,
      clientId: CLIENT_ID,
      metadata: { metricKey: "weight", date: "2026-08-14" },
    });
    expect(JSON.stringify(event.metadata)).not.toContain("90");
  });

  it("audits nothing when the value equalled what stood — nothing was written", async () => {
    vi.mocked(updateMeasurement).mockResolvedValue({ ...RESULT, updated: false, energy: "not_newest" });

    const response = await PATCH(makeRequest({ value: 90 }), { params });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ updated: false });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("rate-limits first, then CSRF, before auth or any read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 })
    );
    expect((await PATCH(makeRequest(), { params })).status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();

    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(
      NextResponse.json({ error: "Invalid origin" }, { status: 403 })
    );
    expect((await PATCH(makeRequest(), { params })).status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
    expect(updateMeasurement).not.toHaveBeenCalled();
  });

  it("refuses a client the coach does not own, and writes nothing", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    expect((await PATCH(makeRequest(), { params })).status).toBe(404);
    expect(updateMeasurement).not.toHaveBeenCalled();
  });

  it("answers a malformed reading id as not found, before any read", async () => {
    const response = await PATCH(makeRequest(), {
      params: Promise.resolve({ id: CLIENT_ID, measurementId: "not-a-uuid" }),
    });

    expect(response.status).toBe(404);
    expect(updateMeasurement).not.toHaveBeenCalled();
  });

  it("400s a body without a positive number, or with anything extra", async () => {
    for (const body of [{}, { value: 0 }, { value: -1 }, { value: "90" }, { value: 90, note: "x" }]) {
      expect((await PATCH(makeRequest(body), { params })).status).toBe(400);
    }
    expect(updateMeasurement).not.toHaveBeenCalled();
  });

  it("maps the service's refusals: not found 404, removed 409, out of bounds 400", async () => {
    vi.mocked(updateMeasurement).mockRejectedValue(new MeasurementNotFoundError());
    expect((await PATCH(makeRequest(), { params })).status).toBe(404);

    vi.mocked(updateMeasurement).mockRejectedValue(new MeasurementStateError("removed"));
    const conflict = await PATCH(makeRequest(), { params });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ success: false, error: "removed" });

    vi.mocked(updateMeasurement).mockRejectedValue(new MeasurementValueError("bounds"));
    expect((await PATCH(makeRequest(), { params })).status).toBe(400);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("500s on an unexpected failure without a data key", async () => {
    vi.mocked(updateMeasurement).mockRejectedValue(new Error("connection reset"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await PATCH(makeRequest(), { params });
    expect(response.status).toBe(500);
    expect((await response.json()).data).toBeUndefined();
    consoleError.mockRestore();
  });
});
