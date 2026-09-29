import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getCoachHabitWeek } from "@/services/client-habit-figures-service";
import { habitDate } from "@/lib/validations/client-habits";

type Params = { params: Promise<{ id: string }> };

/**
 * The week tracker and summary: the client week holding `start` — any day of
 * it; the client's today when absent — each habit's days as they happened and
 * its figures, the totals, and today's planned habits with how many were done.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const start = new URL(request.url).searchParams.get("start");
    if (start !== null && !habitDate.safeParse(start).success) {
      return NextResponse.json({ success: false, error: "Invalid date" }, { status: 400 });
    }

    const week = await getCoachHabitWeek(clientId, start ?? undefined);
    return NextResponse.json(
      { success: true, data: week },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching the habit week:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch the habit week" }, { status: 500 });
  }
}
