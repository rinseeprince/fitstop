import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { orderHabits } from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { habitWriteErrorResponse } from "@/lib/habits/habit-write-response";
import { habitsAfterWrite, readShownWeek } from "@/lib/habits/habits-after-write";
import { orderHabitsSchema } from "@/lib/validations/client-habits";

type Params = { params: Promise<{ id: string }> };

/**
 * The client's habits in their new order. The list names every one of the
 * client's habits, stopped ones included, once; a list that does not is
 * refused, since it was read before a habit came or went. Answers with
 * whether the order changed, the client's habits as they now stand and the
 * week the Habits tab shows (`?week=`).
 */
export async function PUT(request: NextRequest, { params }: Params) {
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
    const validation = orderHabitsSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    // The client's today is read beside the write (it never throws: it falls
    // back to UTC), so the answer's two reads share one today.
    const [changed, today] = await Promise.all([
      orderHabits({ clientId, habitIds: validation.data.habitIds }),
      getClientTodayString(clientId),
    ]);
    return await habitsAfterWrite(clientId, { today, week: shown.week }, (after) => ({ changed, ...after }));
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}
