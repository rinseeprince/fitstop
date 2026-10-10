import { supabaseAdmin } from "./supabase-admin";
import { getNextPlanStartCap } from "./training-event-service";
import { getDateString } from "@/lib/date-helpers";
import type { TrainingEventInsert } from "@/lib/database-helpers";

/** Rows per upsert statement: a long program of several-session days runs to thousands of events. */
const UPSERT_CHUNK = 500;

/** `date + n` days, as a YYYY-MM-DD string. */
function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  return getDateString(d);
}

/** One session of a placed program's day: its placed row and what its calendar entry carries. */
export type ProgramSession = {
  id: string;
  name: string;
  focus: string | null;
  calorieSurplusPercentage: number | null;
  estimatedCalories: number | null;
};

/**
 * Generate training events by walking calendar dates through the program's days
 * — a sequential date-walk over the whole authored program. Each calendar day
 * maps to programDays[position], the sessions of that day in order: each becomes
 * an event on the date at its place in the day (`day_order`). A rest day holds
 * none, so it spawns no training_event and still consumes its date. Every
 * session references a distinct cloned session row and the (client, session,
 * date) upsert is idempotent.
 */
export async function generateProgramEvents(params: {
  clientId: string;
  planId: string;
  programDays: ProgramSession[][];
  startDate: string;
  endDate: string;
}): Promise<number> {
  const { clientId, planId, programDays, startDate, endDate } = params;

  const dayCount = programDays.length;
  if (dayCount === 0) return 0;

  const rows: TrainingEventInsert[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  let position = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    programDays[position].forEach((session, place) => {
      rows.push({
        client_id: clientId,
        training_plan_id: planId,
        training_session_id: session.id,
        date: getDateString(d),
        day_order: place,
        session_name: session.name,
        session_focus: session.focus ?? null,
        estimated_calories: session.estimatedCalories ?? null,
        calorie_surplus_percentage: session.calorieSurplusPercentage ?? null,
        status: "scheduled",
        is_modified: false,
      });
    });
    // Every caller lays exactly as many days as its window has, so the walk
    // cannot run off the end; the modulo is a cheap guard.
    position = (position + 1) % dayCount;
  }

  if (rows.length === 0) return 0;

  // Chunked: 52 weeks of days holding several sessions each is thousands of
  // rows, and one statement of unbounded width is its own problem.
  for (let from = 0; from < rows.length; from += UPSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from("training_events")
      .upsert(rows.slice(from, from + UPSERT_CHUNK), {
        onConflict: "client_id,training_session_id,date",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`Failed to generate events: ${error.message}`);
  }

  return rows.length;
}

/** What bounds a program's window from a date, and which bound it is. */
export type WindowCap = {
  /** The last day a program starting on the queried date may run to. */
  endsOn: string;
  source: "next_plan";
};

/**
 * The furthest day a program starting on `startDate` may run to: the day
 * before the next live program starts. Null when no program follows, so
 * nothing bounds the program but its own length.
 *
 * One question for placement and for the plan editor, so an edited program
 * stays inside the bound placement gave it.
 */
export async function resolveWindowCap(
  clientId: string,
  startDate: string,
): Promise<WindowCap | null> {
  const nextPlanCap = await getNextPlanStartCap(clientId, startDate);
  return nextPlanCap ? { endsOn: nextPlanCap, source: "next_plan" } : null;
}

/**
 * How far a NEW placement from `startDate` runs: the program's own authored
 * length, capped at the day before the next coexisting program starts. A
 * program shorter than the gap to the next one runs its length and stops;
 * nothing stretches it to fill the gap.
 *
 * Decided once, here, and stored on the row (migration 167): every reader
 * takes a program's end from `training_plans.effective_until`, and the plan
 * editor's save moves it under the same cap.
 */
export async function resolvePlacementWindowEnd(params: {
  clientId: string;
  /** The authored program's days — its length, however many sessions they hold. */
  dayCount: number;
  startDate: string;
}): Promise<string> {
  const { clientId, dayCount, startDate } = params;
  const ownEnd = placementEndDate(startDate, dayCount);
  const cap = await resolveWindowCap(clientId, startDate);
  return cap && cap.endsOn < ownEnd ? cap.endsOn : ownEnd;
}

/**
 * The last day of a placed program: `startDate + max(1, dayCount) − 1`, the
 * length a placement asks for. Nothing derives an existing program's end
 * from its rows any more — the end is on the row (migration 167) and every
 * reader takes it from there.
 */
export function placementEndDate(startDate: string, dayCount: number): string {
  return addDays(startDate, Math.max(1, dayCount) - 1);
}
