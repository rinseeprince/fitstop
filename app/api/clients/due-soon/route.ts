import { NextRequest, NextResponse } from "next/server";
import { getClientsDueSoon } from "@/services/check-in-tracking-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import type { GetClientsDueSoonResponse } from "@/types/check-in";

/**
 * GET /api/clients/due-soon
 * Returns clients whose check-ins are due within the next 48 hours
 * Requires authentication
 */
export async function GET(request: NextRequest) {
  // Apply rate limiting
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clients = await getClientsDueSoon(coachId);

    const response: GetClientsDueSoonResponse = {
      clients,
      total: clients.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching clients due soon:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch clients due soon",
      },
      { status: 500 }
    );
  }
}
