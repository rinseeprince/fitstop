import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/services/supabase-admin"
import { apiRateLimit } from "@/lib/rate-limit"

export async function GET(request: NextRequest) {
  // Rate-limit the OAuth/magic-link code exchange (was previously unguarded).
  // apiRateLimit (60/min/IP) tolerates legitimate logins behind shared NAT while
  // blocking abuse of the code-exchange endpoint.
  const rateLimitResult = await apiRateLimit(request)
  if (rateLimitResult) return rateLimitResult

  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const type = requestUrl.searchParams.get("type")

  if (!code) {
    return NextResponse.redirect(new URL("/login", requestUrl.origin))
  }

  const cookieStore = await cookies()
  // Secure over https (production) but not plain http (local dev).
  const secure = request.headers.get("x-forwarded-proto") === "https"

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, { ...options, secure })
          )
        },
      },
    }
  )

  // Exchange code for session
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    console.error("Error exchanging code for session:", error)
    return NextResponse.redirect(new URL("/login", requestUrl.origin))
  }

  const user = data.user

  // Detect an invited client landing back from the magic link. Account<->client
  // linking is performed by POST /api/invitations/accept (token-validated) inside
  // the /invite/[token] page — NOT here. This callback only routes the user.
  //
  // SECURITY: we deliberately do NOT link based on a clientId from the URL or user
  // metadata. That path was an unauthenticated account-takeover vector — an
  // attacker with their own session could pass any victim client UUID and have it
  // bound to their account (it called the unchecked acceptInvitation()).
  const isInvitation =
    type === "invitation" || user.user_metadata?.role === "client"

  if (isInvitation) {
    // New invited users via magic link haven't set a password yet -> onboarding.
    const needsOnboarding = !user.user_metadata?.password_set

    if (needsOnboarding) {
      return NextResponse.redirect(
        new URL("/client/onboarding", requestUrl.origin)
      )
    }

    // Already onboarded client
    return NextResponse.redirect(new URL("/client", requestUrl.origin))
  }

  // Check user's profile role for trainers
  const { data: profileData } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  const profile = profileData as { role: string } | null

  if (profile?.role === "client") {
    return NextResponse.redirect(
      new URL("/client", requestUrl.origin)
    )
  }

  // Default: redirect trainers to dashboard
  return NextResponse.redirect(new URL("/dashboard", requestUrl.origin))
}
