import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getClientById } from "@/services/client-service";
import { savePlanFromCalendar } from "@/services/coach-library-calendar-service";
import { z } from "zod";

const fromCalendarSchema = z.object({
  clientId: z.string().uuid(),
  planId: z.string().uuid(),
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  name: z.string().min(1).max(200),
});

/**
 * POST - Save a client's training plan week to the coach library.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = fromCalendarSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { clientId, planId, weekStartDate, name } = validation.data;

    const client = await getClientById(clientId);
    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const savedPlanId = await savePlanFromCalendar(coachId, clientId, planId, weekStartDate, name);

    return NextResponse.json({ success: true, savedPlanId }, { status: 200 });
  } catch (error) {
    console.error("Error saving plan from calendar:", error);
    return NextResponse.json({ error: "Failed to save plan from calendar" }, { status: 500 });
  }
}
