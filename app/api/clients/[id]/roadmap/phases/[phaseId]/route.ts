import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { mapPhaseRow } from "@/services/roadmap-service";
import { updatePhase, deletePhase } from "@/services/phase-service";
import type { PhaseRow } from "@/types/roadmap";
// Uses supabaseAdmin: coach querying across client-related tables (exception 2)
import { supabaseAdmin } from "@/services/supabase-admin";
import { updatePhaseSchema } from "@/lib/validations/roadmap";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId, phaseId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    // Scoped to client_id to prevent cross-client access. Phases from archived
    // roadmaps are intentionally queryable so coaches can review historical details.
    const { data: phaseRow, error: phaseError } = await supabaseAdmin
      .from("phases")
      .select("*")
      .eq("id", phaseId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (phaseError) {
      console.error("Error fetching phase:", phaseError);
      return NextResponse.json(
        { error: "Failed to fetch phase" },
        { status: 500 }
      );
    }

    if (!phaseRow) {
      return NextResponse.json(
        { success: false, error: "Phase not found" },
        { status: 404 }
      );
    }

    const phase = mapPhaseRow(phaseRow as unknown as PhaseRow);

    // Fetch linked plans in parallel
    const [trainingPlans, nutritionPlans, habits] = await Promise.all([
      supabaseAdmin
        .from("training_plans")
        .select("id, name, status")
        .eq("phase_id", phaseId),
      supabaseAdmin
        .from("nutrition_plans")
        .select("id, status, effective_from")
        .eq("phase_id", phaseId),
      supabaseAdmin
        .from("daily_habits")
        .select("id, name, is_active")
        .eq("phase_id", phaseId),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: {
          phase,
          linkedPlans: {
            trainingPlans: trainingPlans.data || [],
            nutritionPlans: nutritionPlans.data || [],
            habits: habits.data || [],
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching phase detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch phase detail" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, phaseId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const body = await request.json();
    const validation = updatePhaseSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const updated = await updatePhase(phaseId, clientId, validation.data);

    return NextResponse.json(
      { success: true, data: updated },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update phase";
    if (message === "Phase not found") {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }
    if (message === "Phase goals can only be edited while the phase is in planned status") {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
    console.error("Error updating phase:", error);
    return NextResponse.json(
      { error: "Failed to update phase" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, phaseId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    await deletePhase(phaseId, clientId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete phase";
    if (message.includes("has been started or completed")) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
    console.error("Error deleting phase:", error);
    return NextResponse.json(
      { error: "Failed to delete phase" },
      { status: 500 }
    );
  }
}
