import { NextRequest, NextResponse } from "next/server"
import { coachApiRateLimit } from "@/lib/rate-limit"
import { getAuthenticatedCoachId } from "@/lib/auth-helpers"
import { evaluateAllClientTriggers } from "@/services/attention-feed-service"
import type { AttentionFeedResponse } from "@/types/attention-feed"

export async function GET(request: NextRequest) {
  // Rate limiting check - must be first
  const rateLimitResult = await coachApiRateLimit(request)
  if (rateLimitResult) return rateLimitResult

  try {
    const coachId = await getAuthenticatedCoachId(request)
    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Evaluate triggers for all clients
    const { clients, totalClientCount } = await evaluateAllClientTriggers(coachId)

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