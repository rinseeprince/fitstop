import { NextRequest, NextResponse } from "next/server";
import { getOverdueClients } from "@/services/check-in-tracking-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import type { GetOverdueClientsResponse } from "@/types/check-in";

/**
 * GET /api/clients/overdue
 * Returns all clients who are overdue for their check-ins
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

    const clients = await getOverdueClients(coachId);

    const response: GetOverdueClientsResponse = {
      clients,
      total: clients.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching overdue clients:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch overdue clients",
      },
      { status: 500 }
    );
  }
}
