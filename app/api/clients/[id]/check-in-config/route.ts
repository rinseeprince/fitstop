import { NextRequest, NextResponse } from "next/server";
import { updateClientCheckInConfig, getClientById } from "@/services/client-service";
import { updateCheckInConfigSchema } from "@/lib/validations/client";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
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

    // Parse and validate request body
    const body = await request.json();
    const validationResult = updateCheckInConfigSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.errors },
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
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update check-in config",
      },
      { status: 500 }
    );
  }
}
