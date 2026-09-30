import { NextResponse } from "next/server";
import { getCoachHabitList } from "@/services/client-habit-figures-service";
import type { CoachHabitList } from "@/types/habits";

/**
 * The answer to a coach's habit write that committed: the client's habits as
 * they now stand, shaped by the route — so the Habits tab lands the list the
 * write made in the same tick it closes what the write was made in. The
 * client's today is read here unless the route already holds it. Should any
 * read fail, the write still stands and the answer says so: a success whose
 * habits are null, so the screen reads them again rather than calling the
 * save a failure — a save sent again would add a habit twice.
 */
export async function habitListAfterWrite<T>(
  clientId: string,
  clientToday: string | undefined,
  answer: (habits: CoachHabitList | null) => T
): Promise<NextResponse> {
  let habits: CoachHabitList | null;
  try {
    habits = await getCoachHabitList(clientId, clientToday);
  } catch (error) {
    console.error("Habit write committed, reading the habits back failed:", error);
    habits = null;
  }
  return NextResponse.json({ success: true, data: answer(habits) });
}
