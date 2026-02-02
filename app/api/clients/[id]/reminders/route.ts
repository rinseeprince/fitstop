import { NextRequest, NextResponse } from "next/server";
import { getClientReminders } from "@/services/reminder-service";
import { getClientById } from "@/services/client-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import type { GetClientRemindersResponse } from "@/types/check-in";

/**
 * GET /api/clients/[id]/reminders
 * Get reminder history for a specific client
 * Requires authentication
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Apply rate limiting
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    // Verify client belongs to this coach
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Unauthorized - client does not belong to this coach" },
        { status: 403 }
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");

    // Fetch reminders
    const reminders = await getClientReminders(clientId, limit);

    const response: GetClientRemindersResponse = {
      reminders,
      total: reminders.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching client reminders:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch client reminders",
      },
      { status: 500 }
    );
  }
}
