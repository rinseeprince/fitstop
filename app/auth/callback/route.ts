import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { acceptInvitation } from "@/services/invitation-service"
import { supabaseAdmin } from "@/services/supabase-admin"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const type = requestUrl.searchParams.get("type")
  const clientId = requestUrl.searchParams.get("clientId")

  if (!code) {
    return NextResponse.redirect(new URL("/login", requestUrl.origin))
  }

  const cookieStore = await cookies()

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
            cookieStore.set(name, value, options)
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

  // Check if this is a client invitation
  const isInvitation =
    type === "invitation" ||
    user.user_metadata?.role === "client" ||
    !!clientId

  if (isInvitation) {
    // Get clientId from URL params or user metadata
    const invitedClientId = clientId || user.user_metadata?.clientId

    if (invitedClientId) {
      // Accept the invitation (links user to client record)
      try {
        await acceptInvitation(invitedClientId, user.id)
      } catch (error) {
        console.error("Error accepting invitation:", error)
      }
    }

    // Check if user needs to set password (new invited user)
    // Invited users via magic link don't have a password set yet
    const needsOnboarding = !user.user_metadata?.password_set

    if (needsOnboarding) {
      return NextResponse.redirect(
        new URL("/client/onboarding", requestUrl.origin)
      )
    }

    // Already onboarded client
    return NextResponse.redirect(
      new URL("/client", requestUrl.origin)
    )
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
