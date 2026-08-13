import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

vi.mock("@/services/client-blocks-facts-service", () => ({
  getBlockFacts: vi.fn(),
}));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getClientTodayString } from "@/services/today-service";
import { getBlockFacts } from "@/services/client-blocks-facts-service";

const TODAY = "2026-08-11";
const mockParams = { params: Promise.resolve({ id: "client-1" }) };

function createRequest() {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/blocks/facts"
  );
}

const notFoundAuth = {
  authorized: false as const,
  response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
};

describe("GET /api/clients/[id]/blocks/facts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
  });

  it("404s a foreign client before any read", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue(notFoundAuth);

    const res = await GET(createRequest(), mockParams);
    expect(res.status).toBe(404);
    expect(getBlockFacts).not.toHaveBeenCalled();
    expect(getClientTodayString).not.toHaveBeenCalled();
  });

  it("returns the facts with no-store caching, threading the client's today", async () => {
    const facts = [
      {
        blockId: "a",
        training: [{ id: "p1", name: "Base", startsOn: "2026-06-01" }],
        nutrition: {
          calories: 2000,
          deficitPerDay: 500,
          changeCount: 0,
          lastChangedOn: null,
          eras: [{ from: "2026-06-01", calories: 2200, deficitPerDay: 500 }],
        },
        notes: [
          { id: "n1", effectiveOn: "2026-06-01", body: "Starting your cut here." },
        ],
      },
    ];
    vi.mocked(getBlockFacts).mockResolvedValue(facts);

    const res = await GET(createRequest(), mockParams);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { facts } });
    expect(getBlockFacts).toHaveBeenCalledWith("client-1", TODAY);
  });

  it("500s with a generic message — never the raw error", async () => {
    vi.mocked(getBlockFacts).mockRejectedValue(
      new Error("relation nutrition_events does not exist")
    );
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const res = await GET(createRequest(), mockParams);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to fetch block facts");
    expect(JSON.stringify(body)).not.toContain("nutrition_events");
    consoleSpy.mockRestore();
  });
});
