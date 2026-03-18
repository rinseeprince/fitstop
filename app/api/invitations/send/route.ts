import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedCoachId } from "@/lib/auth-helpers"
import { sendInvitationSchema } from "@/lib/validations/invitation"
import { sendInvitation } from "@/services/invitation-service"
import { supabaseAdmin } from "@/services/supabase-admin"
import { authRateLimit } from "@/lib/rate-limit"
import { requireCSRFProtection } from "@/lib/csrf-protection"

type ClientRow = {
  id: string
  email: string | null
  name: string
  coach_id: string
  user_id: string | null
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    // Verify trainer is authenticated
    const coachId = await getAuthenticatedCoachId()
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const result = sendInvitationSchema.safeParse(body)

    if (!result.success) {
      console.error("Validation error:", result.error.errors);
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      )
    }

    const { clientId } = result.data

    // Verify the client belongs to this coach
    const { data, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("id, email, name, coach_id, user_id")
      .eq("id", clientId)
      .single()

    const client = data as ClientRow | null

    if (clientError || !client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      )
    }

    if (client.coach_id !== coachId) {
      return NextResponse.json(
        { success: false, error: "Not authorized to invite this client" },
        { status: 403 }
      )
    }

    if (!client.email) {
      return NextResponse.json(
        { success: false, error: "Client does not have an email address" },
        { status: 400 }
      )
    }

    // Check if client already has an account
    if (client.user_id) {
      return NextResponse.json(
        { success: false, error: "Client already has an account" },
        { status: 400 }
      )
    }

    // Send the invitation
    const invitationResult = await sendInvitation(clientId)

    if (!invitationResult.success) {
      return NextResponse.json(
        { success: false, error: invitationResult.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: invitationResult.invitation,
    })
  } catch (error) {
    console.error("Error sending invitation:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    )
  }
}
