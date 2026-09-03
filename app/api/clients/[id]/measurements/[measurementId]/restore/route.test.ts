import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  MeasurementNotFoundError,
  MeasurementStateError,
} from "@/lib/measurements/edit-errors";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn() }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn() }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/measurement-edits-service", () => ({ restoreMeasurement: vi.fn() }));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn() }));

import { POST } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { restoreMeasurement } from "@/services/measurement-edits-service";
import { recordAuditEvent } from "@/services/audit-log-service";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ROW_ID = "22222222-2222-4222-8222-222222222222";

const makeRequest = () =>
  new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/measurements/${ROW_ID}/restore`, {
    method: "POST",
  });

const params = Promise.resolve({ id: CLIENT_ID, measurementId: ROW_ID });

const RESULT = { id: ROW_ID, metricKey: "bodyFat" as const, sourceId: null, energy: "not_newest" as const };

describe("POST /api/clients/[id]/measurements/[measurementId]/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-1" });
    vi.mocked(restoreMeasurement).mockResolvedValue(RESULT);
    vi.mocked(recordAuditEvent).mockResolvedValue(undefined);
  });

  it("restores the reading, no body, and audits it with the metric only", async () => {
    const request = makeRequest();
    const response = await POST(request, { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: RESULT });
    expect(restoreMeasurement).toHaveBeenCalledWith({ clientId: CLIENT_ID, measurementId: ROW_ID });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith(CLIENT_ID, request);
    expect(vi.mocked(recordAuditEvent).mock.calls[0][0]).toMatchObject({
      actorId: "coach-1",
      action: "measurement.restore",
      targetId: ROW_ID,
      clientId: CLIENT_ID,
      metadata: { metricKey: "bodyFat" },
    });
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
    expect(restoreMeasurement).not.toHaveBeenCalled();
  });

  it("refuses a client the coach does not own, and a malformed reading id", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await POST(makeRequest(), { params })).status).toBe(404);

    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-1" });
    expect(
      (await POST(makeRequest(), { params: Promise.resolve({ id: CLIENT_ID, measurementId: "nope" }) }))
        .status
    ).toBe(404);
    expect(restoreMeasurement).not.toHaveBeenCalled();
  });

  it("maps the refusals: a foreign row 404, a live row 409", async () => {
    vi.mocked(restoreMeasurement).mockRejectedValue(new MeasurementNotFoundError());
    expect((await POST(makeRequest(), { params })).status).toBe(404);

    vi.mocked(restoreMeasurement).mockRejectedValue(new MeasurementStateError("live"));
    expect((await POST(makeRequest(), { params })).status).toBe(409);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("500s on an unexpected failure", async () => {
    vi.mocked(restoreMeasurement).mockRejectedValue(new Error("connection reset"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await POST(makeRequest(), { params })).status).toBe(500);
    consoleError.mockRestore();
  });
});
