import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { changeHabit } from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { habitWriteErrorResponse } from "@/lib/habits/habit-write-response";
import { changeHabitSchema, habitIdParam } from "@/lib/validations/client-habits";

type Params = { params: Promise<{ id: string; habitId: string }> };

/**
 * A habit's target and days from a day — the client's today when `startsOn` is
 * absent — which also starts a stopped habit again. The version running the
 * day before ends then; a version queued after it stands.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, habitId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;
    if (!habitIdParam.safeParse(habitId).success) {
      return NextResponse.json({ success: false, error: "Habit not found." }, { status: 404 });
    }

    const validation = changeHabitSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }
    const body = validation.data;

    const today = await getClientTodayString(clientId);
    const startsOn = body.startsOn ?? today;
    const changed = await changeHabit({
      habitId,
      clientId,
      today,
      startsOn,
      createdBy: auth.coachId,
      target: body.target ?? null,
      schedule: "weekdays" in body ? { weekdays: body.weekdays } : { timesPerWeek: body.timesPerWeek },
    });

    if (changed) {
      void recordAuditEvent({
        actorId: auth.coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.HABIT_CHANGE,
        targetTable: "client_habits",
        targetId: habitId,
        clientId,
        metadata: { startsOn },
        request,
      });
    }

    return NextResponse.json({ success: true, data: { changed } });
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}
