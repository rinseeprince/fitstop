import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getActiveTrainingPlan, getTrainingPlanById } from "@/services/training-service";
import { getClientTodayString } from "@/services/today-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { aiRateLimit, coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { generateTrainingPlanSchema } from "@/lib/validations/training";
import {
  orchestrateTrainingPlanGeneration,
  TrainingPlanError,
} from "@/services/training-plan-orchestrator";

// POST - Generate new training plan via AI
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await aiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    const body = await request.json();
    const validation = generateTrainingPlanSchema.safeParse(body);

    if (!validation.success) {
      console.error("Training plan validation errors:", validation.error.errors);
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const result = await orchestrateTrainingPlanGeneration(clientId, coachId, {
      coachPrompt: validation.data.coachPrompt,
      coachSuppliedName: validation.data.name,
      effectiveFrom: validation.data.effectiveFrom,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof TrainingPlanError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Error generating training plan:", error);
    return NextResponse.json(
      { error: "Failed to generate training plan" },
      { status: 500 }
    );
  }
}

// GET - Get active training plan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    // "Active" is date-driven: the provenance plan whose range covers today.
    const clientToday = await getClientTodayString(clientId);
    const activePlan = await getActiveTrainingPlan(clientId);

    // The next future plan (additive placement has no 'planned' status; a future
    // plan is simply one whose effective_from is after today).
    const { data: nextPlanRow } = await supabaseAdmin
      .from("training_plans")
      .select("id, effective_from")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .gt("effective_from", clientToday)
      .order("effective_from", { ascending: true })
      .limit(1)
      .maybeSingle();

    const nextFullPlan = nextPlanRow
      ? await getTrainingPlanById(nextPlanRow.id)
      : null;

    // With no plan covering today, the next future plan IS the coach's working
    // plan: returned as `plan` (editable in the builder) with `scheduledFor`
    // marking its start date. `upcomingPlan` only describes a future plan queued
    // BEHIND a plan that already covers today.
    const upcomingPlan =
      activePlan && nextPlanRow && nextFullPlan
        ? {
            id: nextFullPlan.id,
            effectiveFrom: nextPlanRow.effective_from,
            name: nextFullPlan.name,
            splitType: nextFullPlan.splitType,
            frequencyPerWeek: nextFullPlan.frequencyPerWeek,
            sessions: nextFullPlan.sessions,
          }
        : null;

    return NextResponse.json(
      {
        success: true,
        plan: activePlan ?? nextFullPlan,
        upcomingPlan,
        scheduledFor:
          !activePlan && nextPlanRow && nextFullPlan
            ? nextPlanRow.effective_from
            : null,
        clientTimezone: client.timezone,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching training plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch training plan" },
      { status: 500 }
    );
  }
}
