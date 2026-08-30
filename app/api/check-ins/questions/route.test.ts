import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/require-coach-auth", () => ({ requireCoachAuth: vi.fn() }));
vi.mock("@/services/check-in-form-service", () => ({
  listCheckInQuestions: vi.fn(),
  createCheckInQuestion: vi.fn(),
  updateCheckInQuestion: vi.fn(),
}));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));

import { GET, POST } from "./route";
import { PATCH } from "./[questionId]/route";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachAuth } from "@/lib/require-coach-auth";
import {
  createCheckInQuestion,
  listCheckInQuestions,
  updateCheckInQuestion,
} from "@/services/check-in-form-service";

const url = "http://localhost:3000/api/check-ins/questions";
const getReq = () => new NextRequest(url);
const bodyReq = (method: string, body: unknown) =>
  new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const question = {
  id: "q-a",
  prompt: "How was sleep?",
  createdAt: "2026-08-01T00:00:00Z",
};
const params = Promise.resolve({ questionId: "q-a" });

const unauthorized = {
  authorized: false as const,
  response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachAuth).mockResolvedValue({ authorized: true, coachId: "coach-1" });
  vi.mocked(listCheckInQuestions).mockResolvedValue([question]);
  vi.mocked(createCheckInQuestion).mockResolvedValue(question);
  vi.mocked(updateCheckInQuestion).mockResolvedValue(question);
  vi.mocked(requireCSRFProtection).mockResolvedValue(null);
});

describe("GET /api/check-ins/questions", () => {
  it("returns the authenticated coach's bank", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.questions).toEqual([question]);
    expect(listCheckInQuestions).toHaveBeenCalledWith("coach-1");
  });

  it("401s without a coach, and reads nothing", async () => {
    vi.mocked(requireCoachAuth).mockResolvedValueOnce(unauthorized);

    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(listCheckInQuestions).not.toHaveBeenCalled();
  });
});

describe("POST /api/check-ins/questions", () => {
  it("creates the question against the RESOLVED coach id, never a body value", async () => {
    const res = await POST(bodyReq("POST", { prompt: "How was sleep?", coachId: "spoofed" }));

    expect(res.status).toBe(201);
    expect(createCheckInQuestion).toHaveBeenCalledWith("coach-1", "How was sleep?");
  });

  it("refuses without CSRF, before auth", async () => {
    vi.mocked(requireCSRFProtection).mockResolvedValueOnce(
      NextResponse.json({ error: "CSRF" }, { status: 403 })
    );

    const res = await POST(bodyReq("POST", { prompt: "x" }));

    expect(res.status).toBe(403);
    expect(requireCoachAuth).not.toHaveBeenCalled();
  });

  it("400s a blank prompt", async () => {
    const res = await POST(bodyReq("POST", { prompt: "   " }));

    expect(res.status).toBe(400);
    expect(createCheckInQuestion).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/check-ins/questions/[questionId]", () => {
  it("rewords through the coach-scoped service", async () => {
    const res = await PATCH(bodyReq("PATCH", { prompt: "New wording" }), { params });

    expect(res.status).toBe(200);
    expect(updateCheckInQuestion).toHaveBeenCalledWith("coach-1", "q-a", {
      prompt: "New wording",
    });
  });

  it("archives", async () => {
    const res = await PATCH(bodyReq("PATCH", { archived: true }), { params });

    expect(res.status).toBe(200);
    expect(updateCheckInQuestion).toHaveBeenCalledWith("coach-1", "q-a", { archived: true });
  });

  it("404s a question belonging to another coach", async () => {
    // The service scopes its UPDATE on both id and coach_id, so a foreign id
    // matches zero rows — the route must not leak that it exists.
    vi.mocked(updateCheckInQuestion).mockResolvedValueOnce(null);

    const res = await PATCH(bodyReq("PATCH", { prompt: "x" }), { params });

    expect(res.status).toBe(404);
  });

  it("400s an empty patch", async () => {
    const res = await PATCH(bodyReq("PATCH", {}), { params });

    expect(res.status).toBe(400);
    expect(updateCheckInQuestion).not.toHaveBeenCalled();
  });
});
