import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { coachApiRateLimit } from "@/lib/rate-limit"
import { requireCSRFProtection } from "@/lib/csrf-protection"
import { getAuthenticatedCoachId } from "@/lib/auth-helpers"
import { supabaseAdmin } from "@/services/supabase-admin"

const dismissSchema = z.object({
  clientId: z.string().uuid(),
  alertType: z.string(),
})

export async function POST(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request)
  if (rateLimitResult) return rateLimitResult

  const csrfError = await requireCSRFProtection(request)
  if (csrfError) return csrfError

  try {
    const coachId = await getAuthenticatedCoachId(request)
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      )
    }

    const rawBody = await request.json()
    const parsed = dismissSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      )
    }

    const { clientId, alertType } = parsed.data

    // IDOR check: verify the coach owns this client
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("coach_id", coachId)
      .maybeSingle()

    if (clientError || !client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      )
    }

    const { error: upsertError } = await supabaseAdmin
      .from("attention_dismissals")
      .upsert({
        coach_id: coachId,
        client_id: clientId,
        alert_type: alertType,
        dismissed_at: new Date().toISOString().split("T")[0],
      }, { onConflict: "coach_id,client_id,alert_type" })

    if (upsertError) {
      console.error("Error dismissing alert:", upsertError)
      return NextResponse.json(
        { success: false, error: "Failed to dismiss alert" },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Dismiss alert error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to dismiss alert" },
      { status: 500 }
    )
  }
}
