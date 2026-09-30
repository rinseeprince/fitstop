import { NextResponse, type NextRequest } from "next/server";
import {
  getCoachHabitList,
  getCoachHabitWeek,
  getCoachHabitWeekAndCurrent,
} from "@/services/client-habit-figures-service";
import { habitDate } from "@/lib/validations/client-habits";
import type { HabitsAfterWrite } from "@/types/habits";

/**
 * The week the Habits tab shows, named by the page with a write (`?week=`,
 * any day of it; absent: the client's current week), so the write's answer
 * carries that week. A value that is not a real day is a 400 before anything
 * is written.
 */
export function readShownWeek(
  request: NextRequest
): { ok: true; week: string | null } | { ok: false; response: NextResponse } {
  const week = request.nextUrl.searchParams.get("week");
  if (week !== null && !habitDate.safeParse(week).success) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Invalid date" }, { status: 400 }) };
  }
  return { ok: true, week };
}

/**
 * The answer to a coach's habit write that committed: the client's habits as
 * they now stand AND the week the Habits tab shows (`readShownWeek`) — with,
 * when that is another week, the client's current week, which the tab's
 * summary always shows — read side by side and shaped by the route, so the tab
 * puts them on screen in the same tick it closes what the write was made in,
 * and the card changes in place with no loading state between (CONVENTIONS §7
 * → "Refreshing after a write"). The client's today is the route's when it has
 * read it, else each read's own. Should any read fail, the write still stands
 * and the answer says so: a success with none of them, so the screen reads
 * them again rather than calling the save a failure — a save sent again would
 * add a habit twice.
 */
export async function habitsAfterWrite<T>(
  clientId: string,
  read: { today?: string; week: string | null },
  answer: (after: HabitsAfterWrite) => T
): Promise<NextResponse> {
  let after: HabitsAfterWrite;
  try {
    const [habits, weeks] = await Promise.all([
      getCoachHabitList(clientId, read.today),
      read.week === null
        ? getCoachHabitWeek(clientId, undefined, read.today).then((week) => ({ week, currentWeek: null }))
        : getCoachHabitWeekAndCurrent(clientId, read.week, read.today),
    ]);
    after = { habits, ...weeks };
  } catch (error) {
    console.error("Habit write committed, reading the habits back failed:", error);
    after = { habits: null, week: null, currentWeek: null };
  }
  return NextResponse.json({ success: true, data: answer(after) });
}
