import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { deleteHabit, renameHabit } from "@/services/client-habit-writes-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { habitWriteErrorResponse } from "@/lib/habits/habit-write-response";
import { habitListAfterWrite } from "@/lib/habits/habit-list-after-write";
import { habitIdParam, renameHabitSchema } from "@/lib/validations/client-habits";

type Params = { params: Promise<{ id: string; habitId: string }> };

type Verified =
  | { ok: false; response: Response }
  | { ok: true; clientId: string; habitId: string; coachId: string };

/**
 * The route's first four steps: the rate limit, CSRF, the coach owning the
 * client, and the path naming a habit. A response when one refuses; else the
 * verified ids.
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
  return { ok: true, clientId, habitId, coachId: auth.coachId };
}

/**
 * A habit's labels: its name and its how-to (null clears it), on any habit —
 * running, upcoming or stopped. A sent check-in keeps the name it froze.
 * Answers with whether anything changed and the client's habits as they now
 * stand.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const verified = await authorize(request, params);
    if (!verified.ok) return verified.response;
    const { clientId, habitId, coachId } = verified;

    const validation = renameHabitSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const changed = await renameHabit({ habitId, clientId, name: validation.data.name, howTo: validation.data.howTo });

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

    return await habitListAfterWrite(clientId, undefined, (habits) => ({ changed, habits }));
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}

/**
 * A habit the client never made an entry for, deleted with its versions and
 * one-date edits. One with entries is refused — it can only be stopped, so
 * the client's history stays. Answers with the client's habits as they now
 * stand.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const verified = await authorize(request, params);
    if (!verified.ok) return verified.response;
    const { clientId, habitId, coachId } = verified;

    await deleteHabit({ habitId, clientId });

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.HABIT_DELETE,
      targetTable: "client_habits",
      targetId: habitId,
      clientId,
      request,
    });

    return await habitListAfterWrite(clientId, undefined, (habits) => ({ changed: true, habits }));
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}
