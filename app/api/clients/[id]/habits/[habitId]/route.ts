import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { dailyHabitSchema } from "@/lib/validations/daily-habit";
import { updateHabit, deactivateHabit } from "@/services/daily-habits-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { z } from "zod";

async function verifyHabitOwnership(
  habitId: string,
  coachId: string
): Promise<boolean> {
  const { data: habit, error } = await supabaseAdmin
    .from("daily_habits")
    .select("coach_id")
    .eq("id", habitId)
    .single();

  if (error || !habit) return false;
  return habit.coach_id === coachId;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; habitId: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { habitId } = await params;
    const coachId = await getAuthenticatedCoachId(request);

    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const hasAccess = await verifyHabitOwnership(habitId, coachId);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: "Habit not found or access denied" },
        { status: 404 }
      );
    }

    const rawBody = await request.json();
    
    // Convert snake_case to camelCase for compatibility
    const normalizedBody = {
      ...rawBody,
      targetValue: rawBody.targetValue ?? rawBody.target_value,
      targetUnit: rawBody.targetUnit ?? rawBody.target_unit,
      isBoolean: rawBody.isBoolean ?? rawBody.is_boolean,
      isActive: rawBody.isActive ?? rawBody.is_active,
    };
    
    // Validate partial input - only validate fields that are provided
    const partialSchema = dailyHabitSchema.partial().extend({
      isActive: z.boolean().optional(),
    });
    const validationResult = partialSchema.safeParse(normalizedBody);

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

    const updatedHabit = await updateHabit(habitId, validationResult.data);

    return NextResponse.json({
      success: true,
      data: updatedHabit,
    });
  } catch (error) {
    console.error("Error updating habit:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to update habit",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; habitId: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { habitId } = await params;
    const coachId = await getAuthenticatedCoachId(request);

    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const hasAccess = await verifyHabitOwnership(habitId, coachId);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: "Habit not found or access denied" },
        { status: 404 }
      );
    }

    await deactivateHabit(habitId);

    return NextResponse.json({
      success: true,
      data: { message: "Habit deactivated successfully" },
    });
  } catch (error) {
    console.error("Error deactivating habit:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to deactivate habit",
      },
      { status: 500 }
    );
  }
}