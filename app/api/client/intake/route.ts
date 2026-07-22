import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getIntake, createIntake } from "@/services/client-intake-service";
import { toClientFacingIntake } from "@/lib/mappers";
import type { ClientIntake } from "@/types/client-intake";

function getCompletedSteps(intake: ClientIntake): number[] {
  const steps: number[] = [];

  // Step 1: Body & lifestyle
  if (intake.dateOfBirth && intake.gender && intake.height && intake.currentWeight) {
    steps.push(1);
  }

  // Step 2: Goals
  if (intake.primaryGoal) {
    steps.push(2);
  }

  // Step 3: Training
  if (intake.workActivityLevel && intake.daysPerWeek && intake.trainingTimePreference && intake.trainingLocation) {
    steps.push(3);
  }

  // Step 4: Nutrition (optional fields, so check if any are set)
  if (
    intake.cookingFrequency ||
    (intake.dietaryRequirements && intake.dietaryRequirements.length > 0) ||
    intake.dietDescription ||
    intake.hasTrackedMacrosBefore !== undefined
  ) {
    steps.push(4);
  }

  // Step 5: Medical & background
  if (intake.trainingExperienceLevel) {
    steps.push(5);
  }

  return steps;
}

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // Auto-create intake on first access
    let intake = await getIntake(auth.clientId);
    if (!intake) {
      intake = await createIntake(auth.clientId);
    }

    return NextResponse.json({
      success: true,
      data: {
        // Strip coachReviewNotes — coach-only, never client-facing (M6).
        intake: toClientFacingIntake(intake),
        stepsComplete: getCompletedSteps(intake),
      },
    });
  } catch (error) {
    console.error("Error fetching client intake:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch intake" },
      { status: 500 }
    );
  }
}
