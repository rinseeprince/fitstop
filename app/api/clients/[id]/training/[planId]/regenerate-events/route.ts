import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { regenerateFutureEvents } from "@/services/training-event-service";
import { z } from "zod";

const regenerateEventsSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").optional(),
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
    const effectiveFrom = validation.data.effectiveFrom;

    await regenerateFutureEvents(clientId, planId, effectiveFrom);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error regenerating events:", error);
    return NextResponse.json(
      { error: "Failed to regenerate events" },
      { status: 500 }
    );
  }
}
