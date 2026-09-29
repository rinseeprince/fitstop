import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { resetHabitDay, setHabitDay } from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { habitWriteErrorResponse } from "@/lib/habits/habit-write-response";
import { habitDate, habitDayEditSchema, habitIdParam } from "@/lib/validations/client-habits";

type Params = { params: Promise<{ id: string; habitId: string; date: string }> };

type Verified =
  | { ok: false; response: Response }
  | { ok: true; clientId: string; habitId: string; date: string; coachId: string };

/**
 * The route's first four steps: the rate limit, CSRF, the coach owning the
 * client, and the path naming a habit and a real day. A response when one
 * refuses; else the verified ids.
 */
async function authorize(request: NextRequest, params: Params["params"]): Promise<Verified> {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return { ok: false, response: rateLimitResult };

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return { ok: false, response: csrfError };

  const { id: clientId, habitId, date } = await params;
  const auth = await requireCoachOwnsClient(clientId, request);
  if (!auth.authorized) return { ok: false, response: auth.response };
  if (!habitIdParam.safeParse(habitId).success) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Habit not found." }, { status: 404 }) };
  }
  if (!habitDate.safeParse(date).success) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Invalid date" }, { status: 400 }) };
  }
  return { ok: true, clientId, habitId, date, coachId: auth.coachId };
}

/**
 * One date of a set-days habit, today or later: planned or not, and a planned
 * number habit's own target for that day (null or absent: the version's). A
 * day set back to what its version has leaves no edit.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const verified = await authorize(request, params);
    if (!verified.ok) return verified.response;
    const { clientId, habitId, date, coachId } = verified;

    const validation = habitDayEditSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const changed = await setHabitDay({
      habitId,
      clientId,
      today: await getClientTodayString(clientId),
      date,
      planned: validation.data.planned,
      target: validation.data.target ?? null,
      coachId,
    });

    if (changed) {
      void recordAuditEvent({
        actorId: coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.HABIT_DAY_EDIT,
        targetTable: "client_habits",
        targetId: habitId,
        clientId,
        metadata: { date, planned: validation.data.planned },
        request,
      });
    }

    return NextResponse.json({ success: true, data: { changed } });
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}

/** The date's edit removed, today or later: the day is its version's again. */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const verified = await authorize(request, params);
    if (!verified.ok) return verified.response;
    const { clientId, habitId, date, coachId } = verified;

    const changed = await resetHabitDay({
      habitId,
      clientId,
      today: await getClientTodayString(clientId),
      date,
    });

    if (changed) {
      void recordAuditEvent({
        actorId: coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.HABIT_DAY_EDIT,
        targetTable: "client_habits",
        targetId: habitId,
        clientId,
        metadata: { date, reset: true },
        request,
      });
    }

    return NextResponse.json({ success: true, data: { changed } });
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}
