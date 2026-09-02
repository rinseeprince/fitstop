import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { MeasurementSeries } from "@/types/coach-overview";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn() }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/measurement-series-service", () => ({
  getMeasurementSeriesPayload: vi.fn(),
}));

import { GET } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getMeasurementSeriesPayload } from "@/services/measurement-series-service";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/clients/${CLIENT_ID}/measurement-series`
  );
}

const params = Promise.resolve({ id: CLIENT_ID });

const SERIES: MeasurementSeries = {
  weight: [
    {
      date: "2026-07-20",
      value: 90,
      source: "check_in",
      note: null,
      id: "m-1",
      recordedAt: "2026-07-20T08:00:00+00:00",
    },
  ],
  bodyFat: [],
  waist: [],
  hips: [],
  chest: [],
  arms: [],
  thighs: [],
  baseline: {
    weight: { value: 92, date: "2026-07-01", source: "intake", id: "m-0" },
  },
  startDate: "2026-07-01",
};

describe("GET /api/clients/[id]/measurement-series", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
    vi.mocked(getMeasurementSeriesPayload).mockResolvedValue(SERIES);
  });

  it("returns the series in the standard envelope, uncached", async () => {
    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: SERIES });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reads the client's WHOLE history — the service is called with the client id alone", async () => {
    // No window: the browser holds the start date and does the split itself
    // (the Journey lists readings dated before the start under "Before start").
    await GET(makeRequest(), { params });

    expect(getMeasurementSeriesPayload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getMeasurementSeriesPayload).mock.calls[0]).toEqual([CLIENT_ID]);
  });

  it("rate-limits before doing anything else", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 })
    );

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(429);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
    expect(getMeasurementSeriesPayload).not.toHaveBeenCalled();
  });

  it("refuses a client the coach does not own, and reads nothing", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(404);
    expect(getMeasurementSeriesPayload).not.toHaveBeenCalled();
  });

  it("passes the request to the auth helper, so failures log route + hashed IP", async () => {
    const request = makeRequest();
    await GET(request, { params });

    expect(requireCoachOwnsClient).toHaveBeenCalledWith(CLIENT_ID, request);
  });

  it("500s on a read failure instead of returning an empty chart", async () => {
    vi.mocked(getMeasurementSeriesPayload).mockRejectedValue(new Error("connection reset"));

    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(response.status).toBe(500);
    // No `data` — a caller must not be able to mistake a failure for a client
    // who has logged nothing.
    expect(body.data).toBeUndefined();
  });
});
