import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn(),
}))

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}))

vi.mock("@/services/attention-feed-service", () => ({
  evaluateAllClientTriggers: vi.fn(),
}))

import { GET } from "./route"
import { coachApiRateLimit } from "@/lib/rate-limit"
import { getAuthenticatedCoachId } from "@/lib/auth-helpers"
import { evaluateAllClientTriggers } from "@/services/attention-feed-service"
import type { ClientWithAlerts } from "@/types/attention-feed"

const flagged: ClientWithAlerts = {
  clientId: "client-21",
  clientName: "Tomasz Wrobel",
  clientAvatar: null,
  alerts: [
    {
      type: "no_log_gap",
      severity: "medium",
      message: "No logs for 4 days",
      affectedDays: ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"],
      metricData: [],
    },
  ],
}

function feedRequest() {
  return new NextRequest("http://localhost:3000/api/dashboard/attention-feed", { method: "GET" })
}

describe("GET /api/dashboard/attention-feed", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(coachApiRateLimit).mockResolvedValue(null)
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-3")
    vi.mocked(evaluateAllClientTriggers).mockResolvedValue({ clients: [flagged], totalClientCount: 17 })
  })

  it("resolves the coach through the auth seam, handed the request, and evaluates that coach's clients", async () => {
    const request = feedRequest()

    const res = await GET(request)

    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(await res.json()).toEqual({ success: true, data: { clients: [flagged], totalClientCount: 17 } })
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request)
    expect(evaluateAllClientTriggers).toHaveBeenCalledWith("coach-3")
  })

  // Signed out, or signed in with no coach row (a client): the answer every
  // coach route gives.
  it("no coach is 401, and no feed is evaluated", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null)

    const res = await GET(feedRequest())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" })
    expect(evaluateAllClientTriggers).not.toHaveBeenCalled()
  })

  it("a rate-limited request stops at the limiter", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 })
    )

    const res = await GET(feedRequest())

    expect(res.status).toBe(429)
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled()
    expect(evaluateAllClientTriggers).not.toHaveBeenCalled()
  })

  it("a failed evaluation is a 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(evaluateAllClientTriggers).mockRejectedValue(new Error("statement timeout"))

    const res = await GET(feedRequest())

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: "Failed to fetch attention feed" })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
