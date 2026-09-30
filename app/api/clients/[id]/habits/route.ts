import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { addHabits } from "@/services/client-habit-writes-service";
import { getCoachHabitList } from "@/services/client-habit-figures-service";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvents } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { habitWriteErrorResponse } from "@/lib/habits/habit-write-response";
import { habitsAfterWrite, readShownWeek } from "@/lib/habits/habits-after-write";
import { addHabitsSchema } from "@/lib/validations/client-habits";

type Params = { params: Promise<{ id: string }> };

/**
 * The client's habits in their order — running, upcoming and stopped — each
 * with its versions (the history), its one-date edits from the client's today
 * on, whether the client has made any entry for it, where it stands today and
 * its words; and the client's today.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const list = await getCoachHabitList(clientId);
    return NextResponse.json(
      { success: true, data: list },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching habits:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch habits" }, { status: 500 });
  }
}

/**
 * One or more habits added from a day — the client's today when `startsOn` is
 * absent — appended to the client's list in the order given. Answers with the
 * new habits' ids, the client's habits as they now stand and the week the
 * Habits tab shows (`?week=`).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const shown = readShownWeek(request);
    if (!shown.ok) return shown.response;
    const validation = addHabitsSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }
    const body = validation.data;

    const today = await getClientTodayString(clientId);
    const startsOn = body.startsOn ?? today;
    const habitIds = await addHabits({
      clientId,
      today,
      startsOn,
      createdBy: auth.coachId,
      habits: body.habits.map((habit) => ({
        name: habit.name,
        howTo: habit.howTo ?? null,
        measure: habit.measure,
        unit: habit.unit ?? null,
        direction: habit.direction ?? null,
        target: habit.target ?? null,
        schedule: "weekdays" in habit ? { weekdays: habit.weekdays } : { timesPerWeek: habit.timesPerWeek },
      })),
    });

    void recordAuditEvents(
      habitIds.map((habitId) => ({
        actorId: auth.coachId,
        actorRole: "trainer" as const,
        action: AUDIT_ACTIONS.HABIT_CREATE,
        targetTable: "client_habits",
        targetId: habitId,
        clientId,
        metadata: { startsOn },
        request,
      }))
    );

    return await habitsAfterWrite(clientId, { today, week: shown.week }, (after) => ({ habitIds, ...after }));
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}
