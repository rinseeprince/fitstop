import { NextRequest, NextResponse } from "next/server";
import { sendCheckInReminder } from "@/services/reminder-service";
import { getClientById } from "@/services/client-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import type { SendReminderRequest, SendReminderResponse } from "@/types/check-in";

/**
 * POST /api/clients/[id]/reminder
 * Manually send a check-in reminder to a specific client
 * Requires authentication
 */
export async function POST(
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

    // Parse request body
    const body: SendReminderRequest = await request.json();
    const reminderType = body.reminderType || "overdue";

    // Send the reminder (manual send)
    const result = await sendCheckInReminder(clientId, reminderType, true);

    if (!result.success) {
      return NextResponse.json(
        { error: result.errorMessage || "Failed to send reminder" },
        { status: 400 }
      );
    }

    const response: SendReminderResponse = {
      success: true,
      reminderId: result.reminderId,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error sending reminder:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to send reminder",
      },
      { status: 500 }
    );
  }
}
