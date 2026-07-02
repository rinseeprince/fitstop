import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  deleteCatalogExercise,
  updateCatalogExercise,
} from "@/services/exercise-catalog-service";
import { updateCatalogExerciseSchema } from "@/lib/validations/training";

// PATCH - Update a coach-owned catalog exercise (global rows 404).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = updateCatalogExerciseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const { exerciseId } = await params;
    const exercise = await updateCatalogExercise(exerciseId, coachId, parsed.data);
    return NextResponse.json({ success: true, exercise }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Exercise not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("Error updating exercise:", error);
    return NextResponse.json(
      { error: "Failed to update exercise" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a coach-owned catalog exercise. Safe by FK design:
// prescription rows keep their name (exercise_id SET NULL, migs 083/084).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ exerciseId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { exerciseId } = await params;
    await deleteCatalogExercise(exerciseId, coachId);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Exercise not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("Error deleting exercise:", error);
    return NextResponse.json(
      { error: "Failed to delete exercise" },
      { status: 500 }
    );
  }
}
