import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { stopHabit } from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { habitWriteErrorResponse } from "@/lib/habits/habit-write-response";
import { habitListAfterWrite } from "@/lib/habits/habit-list-after-write";
import { habitIdParam, stopHabitSchema } from "@/lib/validations/client-habits";

type Params = { params: Promise<{ id: string; habitId: string }> };

/**
 * A habit stopped from a day — the client's today when `stopsOn` is absent.
 * The version running the day before ends then, and what was queued from that
 * day goes; the habit and its past stay. Answers with whether anything
 * changed and the client's habits as they now stand.
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

    const validation = stopHabitSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const today = await getClientTodayString(clientId);
    const stopsOn = validation.data.stopsOn ?? today;
    const changed = await stopHabit({ habitId, clientId, today, stopsOn });

    if (changed) {
      void recordAuditEvent({
        actorId: auth.coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.HABIT_STOP,
        targetTable: "client_habits",
        targetId: habitId,
        clientId,
        metadata: { stopsOn },
        request,
      });
    }

    return await habitListAfterWrite(clientId, today, (habits) => ({ changed, habits }));
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}
