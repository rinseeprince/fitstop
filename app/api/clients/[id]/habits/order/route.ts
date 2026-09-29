import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { orderHabits } from "@/services/client-habit-writes-service";
import { habitWriteErrorResponse } from "@/lib/habits/habit-write-response";
import { orderHabitsSchema } from "@/lib/validations/client-habits";

type Params = { params: Promise<{ id: string }> };

/**
 * The client's habits in their new order. The list names every one of the
 * client's habits, stopped ones included, once; a list that does not is
 * refused, since it was read before a habit came or went.
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

    const validation = orderHabitsSchema.safeParse(await request.json().catch(() => null));
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const changed = await orderHabits({ clientId, habitIds: validation.data.habitIds });
    return NextResponse.json({ success: true, data: { changed } });
  } catch (error) {
    return habitWriteErrorResponse(error);
  }
}
