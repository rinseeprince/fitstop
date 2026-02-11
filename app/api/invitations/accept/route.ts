import { NextRequest, NextResponse } from "next/server"
import { acceptInvitationByToken, acceptInvitation } from "@/services/invitation-service"
import type { AcceptInvitationResponse } from "@/types/auth"
import { authRateLimit } from "@/lib/rate-limit"
import { requireCSRFProtection } from "@/lib/csrf-protection"

export async function POST(request: NextRequest): Promise<NextResponse<AcceptInvitationResponse>> {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult) return rateLimitResult as NextResponse<AcceptInvitationResponse>;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError as NextResponse<AcceptInvitationResponse>;

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
        error: error instanceof Error ? error.message : "Failed to accept invitation" 
      },
      { status: 500 }
    )
  }
}