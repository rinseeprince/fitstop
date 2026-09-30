import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { clearHabitEntry, saveHabitEntry } from "@/services/client-habit-writes-service";
import { getHabitEntryResult } from "@/services/client-habit-figures-service";
import { getClientWeekAnchor } from "@/services/check-in-week-service";
import { habitWriteErrorResponse } from "@/lib/habits/habit-write-response";
import { habitDate, habitEntrySchema, habitIdParam } from "@/lib/validations/client-habits";
import type { DayOfWeek } from "@/types/check-in";

type Params = { params: Promise<{ habitId: string; date: string }> };

type Path = { ok: false; response: NextResponse } | { ok: true; habitId: string; date: string };

/** The path's habit and day, or the response refusing them: no such habit is a 404, no such day a 400. */
async function readPath(params: Params["params"]): Promise<Path> {
  const { habitId, date } = await params;
  if (!habitIdParam.safeParse(habitId).success) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Habit not found." }, { status: 404 }) };
  }
  if (!habitDate.safeParse(date).success) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Invalid date" }, { status: 400 }) };
  }
  return { ok: true, habitId, date };
}

/**
 * The client's entry for a habit on a day: `{ done }` for a tick habit or
 * `{ value }` for a number habit, with an optional `note` (null clears it,
 * absent keeps it). Any day a version covers takes an entry, planned or not,
 * while the day rule has it open. Answers with the habit's day and week as
 * they now stand. Refused: another client's habit 404, a day no version
 * covers 409, an answer that does not fit the habit 400, a locked day 403.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const path = await readPath(params);
  if (!path.ok) return path.response;

  const validation = habitEntrySchema.safeParse(await request.json().catch(() => null));
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: validation.error.errors },
      { status: 400 }
    );
  }
  const body = validation.data;

  // The week's anchor does not depend on the write, so it is read alongside
  // it — settled apart, so the anchor can never speak for the write.
  const [anchor, written] = await Promise.allSettled([
    getClientWeekAnchor(auth.clientId),
    saveHabitEntry({
      clientId: auth.clientId,
      habitId: path.habitId,
      date: path.date,
      answer: "done" in body ? { done: body.done } : { value: body.value },
      note: body.note,
    }),
  ]);
  if (written.status === "rejected") return habitWriteErrorResponse(written.reason);
  return answerAfterWrite(auth.clientId, path.habitId, path.date, anchor);
}

/** The client's entry for a habit on a day, cleared while the day is open. Answers like PUT. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const path = await readPath(params);
  if (!path.ok) return path.response;

  const [anchor, written] = await Promise.allSettled([
    getClientWeekAnchor(auth.clientId),
    clearHabitEntry({ clientId: auth.clientId, habitId: path.habitId, date: path.date }),
  ]);
  if (written.status === "rejected") return habitWriteErrorResponse(written.reason);
  return answerAfterWrite(auth.clientId, path.habitId, path.date, anchor);
}

/**
 * The answer to a write that committed: the habit's day and week as they now
 * stand. Should reading them fail — the week's anchor or the week — the write
 * still stands and the answer says so: a success with no data, so the screen
 * reads the week again rather than calling the save a failure.
 */
async function answerAfterWrite(
  clientId: string,
  habitId: string,
  date: string,
  anchor: PromiseSettledResult<{ weekday: DayOfWeek }>
): Promise<NextResponse> {
  try {
    if (anchor.status === "rejected") throw anchor.reason;
    const result = await getHabitEntryResult(clientId, habitId, date, anchor.value);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Habit entry written, reading it back failed:", error);
    return NextResponse.json({ success: true, data: null });
  }
}
