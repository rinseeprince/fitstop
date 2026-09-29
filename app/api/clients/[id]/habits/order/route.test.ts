import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { PUT } from "./route";

vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachOwnsClient: vi.fn() }));
vi.mock("@/services/client-habit-writes-service", () => {
  class HabitWriteError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  }
  return { HabitWriteError, orderHabits: vi.fn() };
});

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { HabitWriteError, orderHabits } from "@/services/client-habit-writes-service";

const A = "7c1a4d8e-2f3b-4c5d-8e9f-0a1b2c3d4e5f";
const B = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const params = { params: Promise.resolve({ id: "client-2" }) };
const request = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/clients/client-2/habits/order", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("PUT /api/clients/[id]/habits/order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-3" });
  });

  it("puts the client's habits in the order given", async () => {
    vi.mocked(orderHabits).mockResolvedValue(true);
    const req = request({ habitIds: [B, A] });
    const response = await PUT(req, params);
    expect(await response.json()).toEqual({ success: true, data: { changed: true } });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-2", req);
    expect(orderHabits).toHaveBeenCalledWith({ clientId: "client-2", habitIds: [B, A] });
  });

  it("stops at the rate limit and at a failed CSRF check, before the coach is read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await PUT(request({ habitIds: [A] }), params)).status).toBe(429);
    vi.mocked(requireCSRFProtection).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await PUT(request({ habitIds: [A] }), params)).status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
    expect(orderHabits).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty list", { habitIds: [] }],
    ["a habit twice", { habitIds: [A, A] }],
    ["something that is not a habit id", { habitIds: [A, "habit-2"] }],
    ["an unknown key", { habitIds: [A], clientId: "client-9" }],
  ])("refuses %s before any write", async (_label, body) => {
    expect((await PUT(request(body), params)).status).toBe(400);
    expect(orderHabits).not.toHaveBeenCalled();
  });

  it("says the list is out of date when it does not name every habit", async () => {
    vi.mocked(orderHabits).mockRejectedValue(new HabitWriteError("order_mismatch", "x"));
    const response = await PUT(request({ habitIds: [A] }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("The habits have changed since this list was loaded. Reload it and try again.");
  });

  it("orders nothing for another coach's client", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await PUT(request({ habitIds: [A] }), params)).status).toBe(404);
    expect(orderHabits).not.toHaveBeenCalled();
  });
});
