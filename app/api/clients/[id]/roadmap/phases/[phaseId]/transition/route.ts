import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getPhaseReviewData,
  transitionPhase,
} from "@/services/phase-transition-service";
import { milestoneSchema } from "@/lib/validations/roadmap";

type RouteParams = { params: Promise<{ id: string; phaseId: string }> };

const transitionSchema = z.object({
  coachReflection: z.string().optional(),
  nextAction: z.enum(["activate_next", "archive_roadmap"]),
  planHandling: z.object({
    trainingPlan: z.enum(["keep", "archive"]),
    nutritionPlan: z.enum(["keep", "archive"]),
    habits: z.enum(["keep", "archive"]),
  }),
  milestones: z.array(milestoneSchema).max(20).optional(),
});

export async function GET(request: NextRequest, { params }: RouteParams) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId, phaseId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const reviewData = await getPhaseReviewData(phaseId, clientId);

    return NextResponse.json(
      { success: true, data: reviewData },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch review data";
    if (message.includes("Phase not found")) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }
    console.error("Error fetching phase review data:", error);
    return NextResponse.json(
      { error: "Failed to fetch phase review data" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, phaseId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const body = await request.json();
    const validation = transitionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input",
          details: validation.error.errors,
        },
        { status: 400 }
      );
    }

    const result = await transitionPhase(phaseId, clientId, validation.data);

    return NextResponse.json(
      { success: true, data: result },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to transition phase";
    if (message.includes("Phase not found")) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }
    console.error("Error transitioning phase:", error);
    return NextResponse.json(
      { error: "Failed to transition phase" },
      { status: 500 }
    );
  }
}
