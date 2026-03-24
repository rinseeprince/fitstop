// TODO: Add POST /reorder endpoint for bulk phase reordering
// (see app/api/clients/[id]/training/[planId]/sessions/reorder/route.ts)

import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getActiveRoadmap } from "@/services/roadmap-service";
import { createPhase } from "@/services/phase-service";
import { createPhaseSchema } from "@/lib/validations/roadmap";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const roadmap = await getActiveRoadmap(clientId);
    if (!roadmap) {
      return NextResponse.json(
        { success: false, error: "No active roadmap found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true, data: roadmap.phases },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching phases:", error);
    return NextResponse.json(
      { error: "Failed to fetch phases" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const body = await request.json();
    const validation = createPhaseSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const roadmap = await getActiveRoadmap(clientId);
    if (!roadmap) {
      return NextResponse.json(
        { success: false, error: "No active roadmap found. Create a roadmap first." },
        { status: 404 }
      );
    }

    const phase = await createPhase(roadmap.id, validation.data);

    return NextResponse.json(
      { success: true, data: phase },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating phase:", error);
    return NextResponse.json(
      { error: "Failed to create phase" },
      { status: 500 }
    );
  }
}
