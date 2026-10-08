import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { acceptClientInvitation, ACCEPT_REFUSALS, type AcceptRefusal } from "@/services/login-service"
import type { AcceptInvitationResponse } from "@/types/auth"
import { authRateLimit } from "@/lib/rate-limit"
import { requireCSRFProtection } from "@/lib/csrf-protection"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants"
import { captureApiError } from "@/lib/error-handler"

/**
 * The client's answer to their invite: the token and the password they chose,
 * nothing else. zod strips any other key, so no body names whose login it is
 * (D11): the login is made on the invited address and the client is signed in
 * by the session cookie this answer carries.
 */
const acceptInvitationSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})

/** A taken address is a conflict; every other refusal is the link's own fault. */
const REFUSAL_STATUS: Record<AcceptRefusal, number> = {
  invalid: 400,
  expired: 400,
  used: 400,
  account_exists: 409,
}

/**
 * POST /api/invitations/accept (public: the invite link is the credential).
 * authRateLimit, CSRF, zod, then the whole acceptance in one call
 * (services/login-service.ts). The session cookie Better Auth set on sign-in
 * is forwarded on the 200.
 */
export async function POST(request: NextRequest): Promise<NextResponse<AcceptInvitationResponse> | Response> {
  const rateLimitResult = await authRateLimit(request)
  if (rateLimitResult) return rateLimitResult

  const csrfError = await requireCSRFProtection(request)
  if (csrfError) return csrfError

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 })
  }
  const parsed = acceptInvitationSchema.safeParse(body)
  if (!parsed.success) {
    const badPassword = parsed.error.issues.some((issue) => issue.path[0] === "password")
    return NextResponse.json(
      {
        success: false,
        error: badPassword
          ? `Choose a password of ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`
          : ACCEPT_REFUSALS.invalid,
      },
      { status: 400 }
    )
  }

  try {
    const result = await acceptClientInvitation(parsed.data)
    if (!result.accepted) {
      return NextResponse.json(
        { success: false, error: ACCEPT_REFUSALS[result.refusal] },
        { status: REFUSAL_STATUS[result.refusal] }
      )
    }
    const response = NextResponse.json<AcceptInvitationResponse>({ success: true })
    for (const cookie of result.setCookies) response.headers.append("set-cookie", cookie)
    return response
  } catch (error) {
    captureApiError(error, { route: "POST /api/invitations/accept" })
    return NextResponse.json(
      { success: false, error: "Couldn't create your account. Try again." },
      { status: 500 }
    )
  }
}
