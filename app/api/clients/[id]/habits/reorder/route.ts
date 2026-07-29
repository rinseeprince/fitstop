import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { reorderHabits, HabitOwnershipError } from "@/services/daily-habits-service";
import { getClientById } from "@/services/client-service";
import { z } from "zod";

const reorderSchema = z.object({
  habitIds: z.array(z.string().uuid()).min(1, "At least one habit ID is required")
});

async function verifyClientOwnership(
  clientId: string,
  coachId: string
): Promise<boolean> {
  const client = await getClientById(clientId);
  return client !== null && client.coachId === coachId;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;
    const coachId = await getAuthenticatedCoachId(request);

    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const hasAccess = await verifyClientOwnership(clientId, coachId);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validationResult = reorderSchema.safeParse(body);

    if (!validationResult.success) {
      console.error("Validation error:", validationResult.error.format());
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input data",
        },
        { status: 400 }
      );
    }

    await reorderHabits(validationResult.data.habitIds, clientId);

    return NextResponse.json({
      success: true,
      data: { message: "Habits reordered successfully" },
    });
  } catch (error) {
    if (error instanceof HabitOwnershipError) {
      return NextResponse.json(
        { success: false, error: "Habit not found" },
        { status: 404 }
      );
    }
    console.error("Error reordering habits:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to reorder habits",
      },
      { status: 500 }
    );
  }
}