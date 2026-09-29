import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientHabitWeek, HabitWeekRangeError } from "@/services/client-habit-figures-service";
import { habitDate } from "@/lib/validations/client-habits";

/**
 * The habit week over `start`..`end`, dates inside one of the client's weeks —
 * the check-in's period, which a partial first week clamps to the start day.
 * Each habit's days as they happened, its figures, and the totals, from the
 * kernel the coach's week reads; over a clamped period a habit done N times a
 * week asks only for as many as the period's days allow.
 */
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (start === null || end === null) {
    return NextResponse.json({ success: false, error: "Missing required start and end parameters" }, { status: 400 });
  }
  if (!habitDate.safeParse(start).success || !habitDate.safeParse(end).success) {
    return NextResponse.json({ success: false, error: "Invalid date" }, { status: 400 });
  }

  try {
    const week = await getClientHabitWeek(auth.clientId, start, end);
    return NextResponse.json({ success: true, data: week }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HabitWeekRangeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error("Error fetching the habit week:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch habits" }, { status: 500 });
  }
}
