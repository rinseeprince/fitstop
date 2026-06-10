import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getActiveTrainingPlan, promoteTrainingPlanIfReady, getTrainingPlanById } from "@/services/training-service";
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

    // Promote planned plan if its effective date has arrived
    await promoteTrainingPlanIfReady(clientId);

    const activePlan = await getActiveTrainingPlan(clientId);

    // Check for a planned (upcoming) plan
    const { data: plannedPlanRow } = await supabaseAdmin
      .from("training_plans")
      .select("id, effective_from, name, split_type, frequency_per_week")
      .eq("client_id", clientId)
      .eq("status", "planned")
      .maybeSingle();

    const plannedFullPlan = plannedPlanRow
      ? await getTrainingPlanById(plannedPlanRow.id)
      : null;

    // With no active plan, the scheduled plan IS the coach's working plan:
    // it's returned as `plan` (editable in the builder) with `scheduledFor`
    // marking the start date. `upcomingPlan` only describes a planned plan
    // queued BEHIND an active one.
    const upcomingPlan =
      activePlan && plannedPlanRow && plannedFullPlan
        ? {
            id: plannedFullPlan.id,
            effectiveFrom: plannedPlanRow.effective_from,
            name: plannedFullPlan.name,
            splitType: plannedFullPlan.splitType,
            frequencyPerWeek: plannedFullPlan.frequencyPerWeek,
            sessions: plannedFullPlan.sessions,
          }
        : null;

    return NextResponse.json(
      {
        success: true,
        plan: activePlan ?? plannedFullPlan,
        upcomingPlan,
        scheduledFor:
          !activePlan && plannedPlanRow && plannedFullPlan
            ? plannedPlanRow.effective_from
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
