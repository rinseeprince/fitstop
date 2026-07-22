import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies, headers } from "next/headers"
import { coachApiRateLimit } from "@/lib/rate-limit"
import { evaluateAllClientTriggers } from "@/services/attention-feed-service"
import type { AttentionFeedResponse } from "@/types/attention-feed"
import type { Database } from "@/types/database"

async function createClient() {
  const cookieStore = await cookies()
  // Secure over https (production) but not plain http (local dev).
  const secure = (await headers()).get("x-forwarded-proto") === "https"
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, secure })
            )
          } catch {
            // Handle read-only error in Server Components
          }
        },
      },
    }
  )
}

export async function GET(request: NextRequest) {
  // Rate limiting check - must be first
  const rateLimitResult = await coachApiRateLimit(request)
  if (rateLimitResult) return rateLimitResult

  try {
    // Auth check
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Get coach record
    const { data: coach, error: coachError } = await supabase
      .from("coaches")
      .select("id")
      .eq("user_id", user.id)
      .single()

    if (coachError || !coach) {
      return NextResponse.json(
        { success: false, error: "Coach not found" },
        { status: 404 }
      )
    }

    // Evaluate triggers for all clients
    const { clients, totalClientCount } = await evaluateAllClientTriggers(coach.id)

    const response: AttentionFeedResponse = {
      success: true,
      data: {
        clients,
        totalClientCount
      }
    }

    // Return with no-store cache header
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("Attention feed error:", error)
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to fetch attention feed" 
      },
      { status: 500 }
    )
  }
}