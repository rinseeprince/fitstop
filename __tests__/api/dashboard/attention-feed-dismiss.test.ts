import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn().mockResolvedValue("coach-1"),
}))

vi.mock("@/services/supabase-admin", () => {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "client-1" }, error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  }
  return {
    supabaseAdmin: { from: vi.fn(() => mockQuery) },
  }
})

vi.mock("@/services/today-service", () => ({
  getCoachTodayString: vi.fn().mockResolvedValue("2026-06-10"),
}))

import { POST } from "@/app/api/dashboard/attention-feed/dismiss/route"
import { getAuthenticatedCoachId } from "@/lib/auth-helpers"
import { requireCSRFProtection } from "@/lib/csrf-protection"
import { supabaseAdmin } from "@/services/supabase-admin"
import { getCoachTodayString } from "@/services/today-service"

function createRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/dashboard/attention-feed/dismiss", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

describe("/api/dashboard/attention-feed/dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1")
    vi.mocked(requireCSRFProtection).mockResolvedValue(null)
    vi.mocked(getCoachTodayString).mockResolvedValue("2026-06-10")

    // Reset supabaseAdmin mock chain
    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "client-1" }, error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)
  })

  it("should return 200 on valid dismiss", async () => {
    const req = createRequest({
      clientId: "00000000-0000-0000-0000-000000000001",
      alertType: "training_missed",
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it("stamps dismissed_at with the coach-local today, not the server clock", async () => {
    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "client-1" }, error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

    const req = createRequest({
      clientId: "00000000-0000-0000-0000-000000000001",
      alertType: "training_missed",
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(getCoachTodayString).toHaveBeenCalledWith("coach-1")
    expect(mockQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ dismissed_at: "2026-06-10" }),
      { onConflict: "coach_id,client_id,alert_type" }
    )
  })

  it("should return 400 on missing clientId", async () => {
    const req = createRequest({ alertType: "training_missed" })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("should return 400 on invalid clientId (not uuid)", async () => {
    const req = createRequest({ clientId: "not-a-uuid", alertType: "training_missed" })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("should return 400 on missing alertType", async () => {
    const req = createRequest({ clientId: "00000000-0000-0000-0000-000000000001" })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("should return 401 on unauthenticated request", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null)

    const req = createRequest({
      clientId: "00000000-0000-0000-0000-000000000001",
      alertType: "training_missed",
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("should return 403 on CSRF failure", async () => {
    vi.mocked(requireCSRFProtection).mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "CSRF validation failed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    )

    const req = createRequest({
      clientId: "00000000-0000-0000-0000-000000000001",
      alertType: "training_missed",
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it("should return 404 on IDOR (coach doesn't own client)", async () => {
    const mockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockQuery as never)

    const req = createRequest({
      clientId: "00000000-0000-0000-0000-000000000001",
      alertType: "training_missed",
    })

    const res = await POST(req)
    expect(res.status).toBe(404)
  })
})
