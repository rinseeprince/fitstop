import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  duplicateWeek,
  duplicateWeekToRemaining,
} from "@/services/training-event-calendar-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";
import { captureApiError } from "@/lib/error-handler";
import { z } from "zod";

const duplicateWeekSchema = z.object({
  sourceStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  targetStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").optional(),
  fillRemaining: z.boolean().optional(),
  phaseEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").optional(),
});

/**
 * POST - Duplicate a week of training events (with session cloning).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> }
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

    const { id: clientId, planId } = await params;
    const client = await getClientById(clientId);

    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const plan = await getTrainingPlanById(planId);
    if (!plan || plan.clientId !== clientId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = duplicateWeekSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { sourceStartDate, targetStartDate, fillRemaining, phaseEndDate } = validation.data;

    let result: { eventsCreated: number; weeksCreated?: number };

    if (fillRemaining) {
      // Bound "remaining weeks" by the plan's OWN date range. The caller may
      // still pass an explicit phaseEndDate; otherwise derive it from the
      // plan's last scheduled event (additive placement: plans own disjoint
      // windows, so there's no phase/duration to rely on for no-phase plans).
      let fillEnd = phaseEndDate ?? null;
      if (!fillEnd) {
        const { data: lastEvent } = await supabaseAdmin
          .from("training_events")
          .select("date")
          .eq("training_plan_id", planId)
          .eq("status", "scheduled")
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        fillEnd = lastEvent?.date ?? null;
      }

      if (!fillEnd) {
        return NextResponse.json(
          {
            error:
              "No remaining weeks to fill: this plan has no scheduled sessions beyond the source week.",
          },
          { status: 422 }
        );
      }

      result = await duplicateWeekToRemaining(clientId, planId, sourceStartDate, fillEnd);
    } else if (targetStartDate) {
      const weekResult = await duplicateWeek(clientId, planId, sourceStartDate, targetStartDate);
      result = weekResult;
    } else {
      return NextResponse.json(
        { error: "Provide either targetStartDate or fillRemaining" },
        { status: 400 }
      );
    }

    // Cascade: regenerate nutrition events from earliest affected date
    const earliestAffectedDate = fillRemaining
      ? sourceStartDate
      : targetStartDate!;

    const { data: nutritionPlans } = await supabaseAdmin
      .from("nutrition_plans")
      .select("id, status")
      .eq("client_id", clientId)
      .in("status", ["active", "planned"]);

    for (const np of nutritionPlans ?? []) {
      const fromDate = np.status === "active" ? earliestAffectedDate : undefined;
      await regenerateFutureNutritionEvents(clientId, np.id, fromDate).catch((err) =>
        captureApiError(err, {
          action: "cascade-nutrition-events-from-duplicate-week",
          planId: np.id,
        })
      );
    }

    return NextResponse.json(
      { success: true, eventsCreated: result.eventsCreated, weeksCreated: result.weeksCreated },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to duplicate week";

    if (message.includes("outside the current phase")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    console.error("Error duplicating week:", error);
    return NextResponse.json({ error: "Failed to duplicate week" }, { status: 500 });
  }
}
