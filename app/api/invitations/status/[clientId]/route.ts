import { NextRequest, NextResponse } from "next/server"
import { getAuthenticatedCoachId } from "@/lib/auth-helpers"
import { supabaseAdmin } from "@/services/supabase-admin"
import { toClientInvitation } from "@/types/auth"
import type { ClientInvitationRow } from "@/types/auth"

type ClientRow = {
  id: string
  coach_id: string
  user_id: string | null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params

    // Verify trainer is authenticated
    const coachId = await getAuthenticatedCoachId()
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Verify the client belongs to this coach
    const { data, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("id, coach_id, user_id")
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
        { success: false, error: "Not authorized to view this client" },
        { status: 403 }
      )
    }

    // Get invitation status
    const { data: invitation } = await supabaseAdmin
      .from("client_invitations")
      .select("*")
      .eq("client_id", clientId)
      .single()

    return NextResponse.json({
      success: true,
      data: {
        invitation: invitation
          ? toClientInvitation(invitation as ClientInvitationRow)
          : null,
        hasAccount: !!client.user_id,
      },
    })
  } catch (error) {
    console.error("Error fetching invitation status:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    )
  }
}
