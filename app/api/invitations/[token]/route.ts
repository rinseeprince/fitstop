import { NextRequest, NextResponse } from "next/server"
import { getInvitationByToken } from "@/services/invitation-service"
import type { InvitationDetailsResponse } from "@/types/auth"
import { authRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/invitations/[token]
 * Fetch invitation details by token (public endpoint)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse<InvitationDetailsResponse>> {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult) return rateLimitResult as NextResponse<InvitationDetailsResponse>;

  try {
    const { token } = await params

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing invitation token"
        },
        { status: 400 }
      )
    }

    // Validate token format (should be 64-char hex string)
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid invitation token format"
        },
        { status: 400 }
      )
    }

    const result = await getInvitationByToken(token)

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error
        },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      invitation: result.invitation
    })

  } catch (error) {
    console.error("Error in GET /api/invitations/[token]:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error"
      },
      { status: 500 }
    )
  }
}