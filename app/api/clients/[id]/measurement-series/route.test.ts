import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn() }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/measurement-series-service", () => ({ getMeasurementSeries: vi.fn() }));

import { GET } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getMeasurementSeries } from "@/services/measurement-series-service";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/clients/${CLIENT_ID}/measurement-series${query}`
  );
}

const params = Promise.resolve({ id: CLIENT_ID });

const SERIES = { weight: [{ date: "2026-07-20", value: 90 }], bodyFat: [] };

describe("GET /api/clients/[id]/measurement-series", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
    vi.mocked(getMeasurementSeries).mockResolvedValue(SERIES);
  });

  it("returns the series in the standard envelope, uncached", async () => {
    const response = await GET(makeRequest("?from=2026-03-01"), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: SERIES });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rate-limits before doing anything else", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 })
    );

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(429);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
    expect(getMeasurementSeries).not.toHaveBeenCalled();
  });

  it("refuses a client the coach does not own, and reads nothing", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(404);
    expect(getMeasurementSeries).not.toHaveBeenCalled();
  });

  it("passes the request to the auth helper, so failures log route + hashed IP", async () => {
    const request = makeRequest();
    await GET(request, { params });

    expect(requireCoachOwnsClient).toHaveBeenCalledWith(CLIENT_ID, request);
  });

  it("bounds the read on the start date the browser supplies", async () => {
    await GET(makeRequest("?from=2026-03-01"), { params });

    expect(getMeasurementSeries).toHaveBeenCalledWith(CLIENT_ID, "2026-03-01");
  });

  it("reads the whole history when the client has no start date", async () => {
    await GET(makeRequest(), { params });

    expect(getMeasurementSeries).toHaveBeenCalledWith(CLIENT_ID, undefined);
  });

  it("400s a malformed `from` rather than passing it to a PostgREST filter", async () => {
    const response = await GET(makeRequest("?from=2026-03-01,evil"), { params });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(getMeasurementSeries).not.toHaveBeenCalled();
  });

  it("400s a date that passes the shape check but is not a real day", async () => {
    const response = await GET(makeRequest("?from=2026-13-45"), { params });

    expect(response.status).toBe(400);
    expect(getMeasurementSeries).not.toHaveBeenCalled();
  });

  it("500s on a read failure instead of returning an empty chart", async () => {
    vi.mocked(getMeasurementSeries).mockRejectedValue(new Error("connection reset"));

    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(response.status).toBe(500);
    // No `data` — a caller must not be able to mistake a failure for a client
    // who has logged nothing.
    expect(body.data).toBeUndefined();
  });
});
