import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { deleteHabit, renameHabit } from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { habitWriteErrorResponse } from "@/lib/habits/habit-write-response";
import { habitsAfterWrite, readShownWeek } from "@/lib/habits/habits-after-write";
import { habitIdParam, renameHabitSchema } from "@/lib/validations/client-habits";

type Params = { params: Promise<{ id: string; habitId: string }> };

type Verified =
  | { ok: false; response: Response }
  | { ok: true; clientId: string; habitId: string; coachId: string; week: string | null };

/**
 * The route's first steps: the rate limit, CSRF, the coach owning the client,
 * the path naming a habit, and the week the Habits tab shows (`?week=`). A
 * response when one refuses; else the verified ids and the week.
 */
async function authorize(request: NextRequest, params: Params["params"]): Promise<Verified> {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return { ok: false, response: rateLimitResult };

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return { ok: false, response: csrfError };

  const { id: clientId, habitId } = await params;
  const auth = await requireCoachOwnsClient(clientId, request);
  if (!auth.authorized) return { ok: false, response: auth.response };
  if (!habitIdParam.safeParse(habitId).success) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Habit not found." }, { status: 404 }) };
  }
  const shown = readShownWeek(request);
  if (!shown.ok) return { ok: false, response: shown.response };
  return { ok: true, clientId, habitId, coachId: auth.coachId, week: shown.week };
}

/**
 * A habit's labels: its name and its how-to (null clears it), on any habit —
 * running, upcoming or stopped. A sent check-in keeps the name it froze.
 * Answers with whether anything changed, the client's habits as they now
 * stand and the week the Habits tab shows.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const verified = await authorize(request, params);
    if (!verified.ok) return verified.response;
    const { clientId, habitId, coachId, week } = verified;

    const validation = renameHabitSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    // The client's today is read beside the write (it never throws: it falls
    // back to UTC), so the answer's two reads share one today.
    const [changed, today] = await Promise.all([
      renameHabit({ habitId, clientId, name: validation.data.name, howTo: validation.data.howTo }),
      getClientTodayString(clientId),
    ]);

    if (changed) {
      void recordAuditEvent({
        actorId: coachId,
        actorRole: "trainer",
        action: AUDIT_ACTIONS.HABIT_RENAME,
        targetTable: "client_habits",
        targetId: habitId,
        clientId,
        request,
      });
    }

    return await habitsAfterWrite(clientId, { today, week }, (after) => ({ changed, ...after }));
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}

/**
 * Any habit, deleted from the client's today. One the client never made an
 * entry for goes with its versions and one-date edits; one with entries is
 * stopped from today and leaves the list, everything the client logged kept.
 * Answers with the client's habits as they now stand and the week the Habits
 * tab shows.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const verified = await authorize(request, params);
    if (!verified.ok) return verified.response;
    const { clientId, habitId, coachId, week } = verified;

    const today = await getClientTodayString(clientId);
    await deleteHabit({ habitId, clientId, today });

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.HABIT_DELETE,
      targetTable: "client_habits",
      targetId: habitId,
      clientId,
      request,
    });

    return await habitsAfterWrite(clientId, { today, week }, (after) => ({ changed: true, ...after }));
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}
