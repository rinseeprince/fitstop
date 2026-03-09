import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getIntake, createIntake } from "@/services/client-intake-service";
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
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();
    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Auto-create intake on first access
    let intake = await getIntake(clientId);
    if (!intake) {
      intake = await createIntake(clientId);
    }

    return NextResponse.json({
      success: true,
      data: {
        intake,
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
