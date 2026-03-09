import { NextRequest, NextResponse } from "next/server"
import { acceptInvitationByToken, acceptInvitation } from "@/services/invitation-service"
import type { AcceptInvitationResponse } from "@/types/auth"
import { authRateLimit } from "@/lib/rate-limit"
import { requireCSRFProtection } from "@/lib/csrf-protection"
import { isValidUUID } from "@/lib/api-utils"
import { supabaseAdmin } from "@/services/supabase-admin"

export async function POST(request: NextRequest): Promise<NextResponse<AcceptInvitationResponse> | NextResponse | Response> {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const body = await request.json()
    
    // Support both new token-based and legacy clientId-based acceptance
    if (body.token && body.userId) {
      // New token-based flow
      const { token, userId } = body

      if (!token || !userId) {
        return NextResponse.json(
          { success: false, error: "Missing token or userId" },
          { status: 400 }
        )
      }

      const result = await acceptInvitationByToken(token, userId)

      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 }
        )
      }

      return NextResponse.json({ success: true })

    } else if (body.clientId && body.userId) {
      // Legacy clientId-based flow (for backward compatibility)
      console.warn("Using deprecated clientId-based invitation acceptance")

      const { clientId, userId } = body

      // Validate UUID format
      if (!isValidUUID(clientId) || !isValidUUID(userId)) {
        return NextResponse.json(
          { success: false, error: "Invalid parameters" },
          { status: 400 }
        )
      }

      // Verify a pending invitation exists for this client
      const { data: invitation } = await supabaseAdmin
        .from("client_invitations")
        .select("id, email")
        .eq("client_id", clientId)
        .eq("status", "pending")
        .maybeSingle()

      if (!invitation) {
        return NextResponse.json(
          { success: false, error: "No pending invitation found" },
          { status: 400 }
        )
      }

      // Verify the user's email matches the invitation email
      const { data: { user: invitedUser } } = await supabaseAdmin.auth.admin.getUserById(userId)
      if (!invitedUser || invitedUser.email !== invitation.email) {
        return NextResponse.json(
          { success: false, error: "User does not match invitation" },
          { status: 403 }
        )
      }

      await acceptInvitation(clientId, userId)
      return NextResponse.json({ success: true })

    } else {
      return NextResponse.json(
        { 
          success: false, 
          error: "Missing required fields. Provide either (token, userId) or (clientId, userId)" 
        },
        { status: 400 }
      )
    }

  } catch (error) {
    console.error("Error accepting invitation:", error)
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to accept invitation"
      },
      { status: 500 }
    )
  }
}