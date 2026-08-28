import { NextRequest, NextResponse } from "next/server";
import { updateClientCheckInConfig, getClientById } from "@/services/client-service";
import { updateCheckInConfigSchema } from "@/lib/validations/client";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getCoachTodayString } from "@/services/today-service";
import type { UpdateCheckInConfigResponse } from "@/types/check-in";

/**
 * PATCH /api/clients/[id]/check-in-config
 * Update check-in frequency and reminder preferences for a client
 * Requires authentication
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Apply rate limiting
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

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

    // Parse and validate request body
    const body = await request.json();
    const validationResult = updateCheckInConfigSchema.safeParse(body);

    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.errors);
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    // The due date is a date on the COACH's calendar — they are the one
    // setting it — so the past-date bound is checked here against their today,
    // and the schema stays format-only. Same split as the goal deadline; the
    // input's `min` is an affordance, not the control.
    const nextDue = validationResult.data.nextCheckInDue;
    if (nextDue && nextDue < (await getCoachTodayString(coachId))) {
      return NextResponse.json(
        { error: "The next check-in cannot be in the past" },
        { status: 400 }
      );
    }

    // Update check-in configuration
    const updatedClient = await updateClientCheckInConfig(
      clientId,
      validationResult.data
    );

    const response: UpdateCheckInConfigResponse = {
      success: true,
      client: updatedClient,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error updating check-in config:", error);
    return NextResponse.json(
      { error: "Failed to update check-in config" },
      { status: 500 }
    );
  }
}
