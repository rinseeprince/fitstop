import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getActiveTrainingPlan,
  getNextFutureTrainingPlan,
  getTrainingPlanById,
  archiveTrainingPlan,
} from "@/services/training-service";
import { cancelFutureEventsForPlan } from "@/services/training-event-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { getClientTodayString } from "@/services/today-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";

// POST (one-shot AI plan generation) was removed in builder S7: its UI was
// deleted with the drawer's AI-generation mode in S5, and authoring moved to the
// Programs builder + draft assistant. GET and DELETE below are live.

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
    // plan is simply one whose effective_from is after today). Shared predicate —
    // a fourth hand-rolled copy is what let retired plans resurface here.
    const nextPlanRow = await getNextFutureTrainingPlan(clientId, clientToday);

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
            effectiveFrom: nextPlanRow.effectiveFrom,
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
            ? nextPlanRow.effectiveFrom
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

// DELETE - Clear ALL upcoming training sessions for the client across every
// coexisting plan ("Delete future sessions"). Archives each non-archived plan
// and removes its future events; past/completed sessions are kept as history.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);
    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Client-local today anchors the "future" cutoff on the client's calendar.
    const today = await getClientTodayString(clientId);

    const { data: plans } = await supabaseAdmin
      .from("training_plans")
      .select("id")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .neq("status", "archived");

    for (const p of plans ?? []) {
      await archiveTrainingPlan(p.id);
      await cancelFutureEventsForPlan(p.id, today);
    }

    // Cascade once: nutrition burn estimates depend on training events.
    await cascadeNutritionAfterTrainingChange(
      clientId,
      today,
      "cascade-nutrition-events-from-clear-all-training"
    );

    return NextResponse.json(
      { success: true, plansCleared: plans?.length ?? 0 },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error clearing future training sessions:", error);
    return NextResponse.json(
      { error: "Failed to clear future sessions" },
      { status: 500 }
    );
  }
}
