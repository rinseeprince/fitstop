import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { MEASUREMENT_KEYS, type MeasurementKey } from "@/lib/measurements/keys";
import { WELLNESS_KEYS } from "@/lib/wellness/keys";
import type { MeasurementReading } from "@/lib/measurements/day-values";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/measurements-service", () => ({
  appendMeasurements: vi.fn(),
}));

// The route records an audit event (fire-and-forget). Mock it so the test
// doesn't load the real supabase-admin client (which throws without env vars).
vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// The no-future bound lives route-side against the coach's local today (the
// goal-deadline pattern); the zod schema stays format-only. Mock it so the
// bound is deterministic regardless of the suite's wall clock / TZ.
vi.mock("@/services/today-service", () => ({
  getCoachTodayString: vi.fn(),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { appendMeasurements } from "@/services/measurements-service";
import { getCoachTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";

type AppendMeasurementsResult = Awaited<ReturnType<typeof appendMeasurements>>;

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

/** The row the measurement log reports standing for a key after an append. */
const mockReading = (overrides: Partial<MeasurementReading> = {}): MeasurementReading => ({
  id: "m-1",
  metricKey: "weight",
  value: 82.5,
  date: "2026-07-24",
  recordedAt: "2026-07-24T08:00:00.000Z",
  updatedAt: "2026-07-24T08:00:00.000Z",
  measuredAt: null,
  source: "coach_entry",
  sourceId: null,
  note: "morning weigh-in",
  ...overrides,
});

const appended = (reading: MeasurementReading): AppendMeasurementsResult => {
  const rows: AppendMeasurementsResult["rows"] = {};
  rows[reading.metricKey] = reading;
  return { rows, inserted: [reading.metricKey], unchanged: [], energy: "not_newest" };
};

function createMockRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/clients/client-1/measurements", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    metricKey: "weight",
    value: 82.5,
    recordedOn: "2026-07-24",
    note: "morning weigh-in",
    ...overrides,
  };
}

// One value inside each metric's range, every one distinct.
const IN_RANGE: Record<MeasurementKey, number> = {
  weight: 61.3,
  bodyFat: 17.4,
  waist: 83.6,
  hips: 97.2,
  chest: 101.8,
  arms: 34.1,
  thighs: 56.9,
};

describe("POST /api/clients/[id]/measurements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
    vi.mocked(getCoachTodayString).mockResolvedValue("2026-07-24");
    vi.mocked(appendMeasurements).mockResolvedValue(appended(mockReading()));
  });

  it("returns the unauthorized response verbatim and never writes", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: unauthorized,
    });

    const response = await POST(createMockRequest(validBody()), mockParams);

    expect(response).toBe(unauthorized);
    expect(response.status).toBe(401);
    expect(appendMeasurements).not.toHaveBeenCalled();
  });

  it("rate-limits first, then CSRF, before auth or any write", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 })
    );
    expect((await POST(createMockRequest(validBody()), mockParams)).status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();

    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(
      NextResponse.json({ error: "Invalid origin" }, { status: 403 })
    );
    expect((await POST(createMockRequest(validBody()), mockParams)).status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
    expect(appendMeasurements).not.toHaveBeenCalled();
  });

  it("checks ownership before reading the body: an unauthorized caller never sees a validation error", async () => {
    const unauthorized = NextResponse.json({ error: "Client not found" }, { status: 404 });
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: unauthorized,
    });

    const response = await POST(createMockRequest({ metricKey: "height", value: -1 }), mockParams);

    expect(response).toBe(unauthorized);
    expect(appendMeasurements).not.toHaveBeenCalled();
  });

  it("checks the coach owns the client with the request in hand", async () => {
    const request = createMockRequest(validBody());

    await POST(request, mockParams);

    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-1", request);
  });

  it.each(MEASUREMENT_KEYS)("accepts %s, one of the seven body measurements", async (metricKey) => {
    vi.mocked(appendMeasurements).mockResolvedValue(
      appended(mockReading({ metricKey, value: IN_RANGE[metricKey] }))
    );

    const response = await POST(
      createMockRequest(validBody({ metricKey, value: IN_RANGE[metricKey] })),
      mockParams
    );

    expect(response.status).toBe(200);
    expect(appendMeasurements).toHaveBeenCalledWith(
      expect.objectContaining({ values: { [metricKey]: IN_RANGE[metricKey] } })
    );
  });

  it.each([...WELLNESS_KEYS, "height"].map((key, i) => [key, i + 2] as const))(
    "refuses any key but the seven body measurements (%s) and writes nothing",
    async (metricKey, value) => {
      const response = await POST(createMockRequest(validBody({ metricKey, value })), mockParams);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(appendMeasurements).not.toHaveBeenCalled();
    }
  );

  // The bound is KILOGRAMS (WEIGHT_KG_MAX = 250). 300 is the case that
  // matters: it passed the old pounds-shaped 20-700 range, so a coach could
  // store 300 kg — a number that only made sense as pounds, on a column that
  // has been canonical kilograms since migration 141.
  it("refuses a weight above the kg ceiling (300 kg)", async () => {
    const response = await POST(createMockRequest(validBody({ value: 300 })), mockParams);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(appendMeasurements).not.toHaveBeenCalled();
  });

  it("refuses a weight below the kg floor (15 kg)", async () => {
    const response = await POST(createMockRequest(validBody({ value: 15 })), mockParams);

    expect(response.status).toBe(400);
    expect(appendMeasurements).not.toHaveBeenCalled();
  });

  it("accepts a plausible kg weight at the top of the range (249 kg)", async () => {
    const response = await POST(createMockRequest(validBody({ value: 249 })), mockParams);

    expect(response.status).toBe(200);
    expect(appendMeasurements).toHaveBeenCalled();
  });

  it("refuses a malformed day at the schema (25-07-2026)", async () => {
    const response = await POST(
      createMockRequest(validBody({ recordedOn: "25-07-2026" })),
      mockParams
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(appendMeasurements).not.toHaveBeenCalled();
  });

  it("refuses an unknown extra field (.strict())", async () => {
    const response = await POST(createMockRequest(validBody({ extraneous: true })), mockParams);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(appendMeasurements).not.toHaveBeenCalled();
  });

  it("refuses a day after the coach's today", async () => {
    vi.mocked(getCoachTodayString).mockResolvedValue("2026-07-24");

    const response = await POST(
      createMockRequest(validBody({ recordedOn: "2026-07-25" })),
      mockParams
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Entry date cannot be in the future");
    expect(getCoachTodayString).toHaveBeenCalledWith("coach-1");
    expect(appendMeasurements).not.toHaveBeenCalled();
  });

  it("appends the reading as the coach's entry on the day sent, and answers the reading that stands", async () => {
    const waist = mockReading({ id: "m-waist", metricKey: "waist", value: 80.4, date: "2026-07-20", note: "am" });
    vi.mocked(appendMeasurements).mockResolvedValue(appended(waist));

    // 80.4 in, 80.4 out. The Log-measurement dialog converts from the viewer's
    // unit BEFORE sending (CONVENTIONS §20); a second conversion here would
    // store a girth multiplied by 2.54, and a value that reaches the log as
    // 204.2 is the regression this pins against.
    const response = await POST(
      createMockRequest({ metricKey: "waist", value: 80.4, recordedOn: "2026-07-20", note: "am" }),
      mockParams
    );
    const data = await response.json();

    expect(appendMeasurements).toHaveBeenCalledWith({
      clientId: "client-1",
      source: "coach_entry",
      recordedOn: "2026-07-20",
      values: { waist: 80.4 },
      note: "am",
      createdBy: "coach-1",
    });
    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, data: waist });
  });

  it("writes note: null when no note is sent", async () => {
    await POST(createMockRequest({ metricKey: "weight", value: 82.5, recordedOn: "2026-07-24" }), mockParams);

    expect(appendMeasurements).toHaveBeenCalledWith(
      expect.objectContaining({ values: { weight: 82.5 }, note: null, createdBy: "coach-1" })
    );
  });

  it("answers the reading already standing when the value is unchanged, and audits nothing (rule 3 wrote nothing)", async () => {
    const standing = mockReading({ id: "m-standing", value: 84.7 });
    vi.mocked(appendMeasurements).mockResolvedValue({
      rows: { weight: standing },
      inserted: [],
      unchanged: ["weight"],
      energy: "nothing_inserted",
    });

    const response = await POST(createMockRequest(validBody({ value: 84.7 })), mockParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.id).toBe("m-standing");
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("answers a 500 and audits nothing when the log reports no reading for the key", async () => {
    vi.mocked(appendMeasurements).mockResolvedValue({
      rows: {},
      inserted: [],
      unchanged: [],
      energy: "nothing_inserted",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(createMockRequest(validBody({ value: 83.9 })), mockParams);

    expect(response.status).toBe(500);
    expect(recordAuditEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("audits the reading as a measurement.create on client_measurements, metric and date only", async () => {
    await POST(createMockRequest(validBody()), mockParams);

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(recordAuditEvent).mock.calls[0][0];
    expect(event.action).toBe("measurement.create");
    expect(event.targetTable).toBe("client_measurements");
    expect(event.targetId).toBe("m-1");
    expect(event.clientId).toBe("client-1");
    expect(event.actorId).toBe("coach-1");
    // metric + date only — the measurement value is health data and stays out
    expect(event.metadata).toEqual({ metricKey: "weight", date: "2026-07-24" });
    expect(event.metadata).not.toHaveProperty("value");
  });

  it("answers a failed append with a 500 and audits nothing", async () => {
    vi.mocked(appendMeasurements).mockRejectedValueOnce(new Error("Failed to record measurements: boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(createMockRequest(validBody()), mockParams);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to log measurement");
    expect(recordAuditEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
