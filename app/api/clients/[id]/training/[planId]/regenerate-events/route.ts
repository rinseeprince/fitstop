import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { regenerateFutureEvents } from "@/services/training-event-service";
import { countModifiedFutureEvents } from "@/services/training-event-calendar-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { getClientTodayString } from "@/services/today-service";
import { z } from "zod";

const regenerateEventsSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").optional(),
  force: z.boolean().optional(),
});

/**
 * POST - Regenerate training events for a plan from a given date.
 * Called when the coach clicks "Done" after editing sessions.
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

    const body = await request.json().catch(() => ({}));
    const validation = regenerateEventsSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { effectiveFrom, force } = validation.data;

    // When force is explicitly false, check for modified events and return a warning.
    // When force is undefined (existing callers) or true, proceed with full regeneration.
    if (force === false) {
      const modifiedCount = await countModifiedFutureEvents(clientId, planId);
      if (modifiedCount > 0) {
        return NextResponse.json(
          { success: false, modifiedCount, requiresConfirmation: true },
          { status: 200 }
        );
      }
    }

    await regenerateFutureEvents(clientId, planId, effectiveFrom, force);

    // Cascade: regenerate nutrition events (they depend on training burn data).
    // No effectiveFrom -> anchor at client-local today (the prior per-plan
    // fallback), threaded explicitly per cascade-anchor discipline.
    await cascadeNutritionAfterTrainingChange(
      clientId,
      effectiveFrom ?? (await getClientTodayString(clientId)),
      "cascade-nutrition-events-from-training"
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error regenerating events:", error);
    return NextResponse.json(
      { error: "Failed to regenerate events" },
      { status: 500 }
    );
  }
}
