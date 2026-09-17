import { supabaseAdmin } from "./supabase-admin";
import { getNextPlanStartCap } from "./training-event-service";
import { getBlockBoundForDate } from "./client-blocks-service";
import { getDateString } from "@/lib/date-helpers";
import type { TrainingEventInsert } from "@/lib/database-helpers";

/** Rows per upsert statement: a long block of several-session days runs to thousands of events. */
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
  source: "block" | "next_block" | "next_plan";
};

/**
 * The furthest day a program starting on `startDate` may run to, and why: the
 * block covering the date ends it; a block after it caps it at the day before
 * that block; the next live program caps it at the day before its start; the
 * earliest of those wins. `stretchesToCap` says a block COVERS the date, in
 * which case a placement fills to the cap rather than stopping at its own
 * length. A null cap means nothing bounds the program but itself.
 *
 * One question for placement and for the plan editor, so an edited program
 * stays inside the bound placement gave it.
 */
export async function resolveWindowCap(
  clientId: string,
  startDate: string,
): Promise<{ stretchesToCap: boolean; cap: WindowCap | null }> {
  const [bound, nextPlanCap] = await Promise.all([
    getBlockBoundForDate(clientId, startDate),
    getNextPlanStartCap(clientId, startDate),
  ]);

  let cap: WindowCap | null =
    bound?.kind === "covering"
      ? { endsOn: bound.endsOn, source: "block" }
      : bound?.kind === "next"
        ? { endsOn: addDays(bound.startsOn, -1), source: "next_block" }
        : null;
  if (nextPlanCap && (!cap || nextPlanCap < cap.endsOn)) {
    cap = { endsOn: nextPlanCap, source: "next_plan" };
  }
  return { stretchesToCap: bound?.kind === "covering", cap };
}

/**
 * How far a NEW placement from `startDate` should run — the block's last day
 * when a block covers that date, else the program's own authored length.
 * Capped, either way, at the day before the next coexisting program starts.
 *
 * Decided once, here, and stored on the row (migration 167): every reader
 * takes a program's end from `training_plans.effective_until`. The plan
 * editor's save moves it under the same cap, and a block drawn or shortened
 * over it trims it to the block.
 *
 * The block is not a maximum here: a block LONGER than the program stretches
 * the window and the caller repeats the program to fill it, a block SHORTER
 * truncates it. A placement on a day no block covers keeps the program's own
 * length, capped at the day before the NEXT block starts — a cap, never a
 * length, so a program placed in a gap stops at the block rather than filling
 * the gap or running into a block the coach has not set up.
 */
export async function resolvePlacementWindowEnd(params: {
  clientId: string;
  /** The authored program's days — its length, however many sessions they hold. */
  dayCount: number;
  startDate: string;
}): Promise<string> {
  const { clientId, dayCount, startDate } = params;
  const { stretchesToCap, cap } = await resolveWindowCap(clientId, startDate);
  const ownEnd = placementEndDate(startDate, dayCount);
  if (stretchesToCap && cap) return cap.endsOn;
  return cap && cap.endsOn < ownEnd ? cap.endsOn : ownEnd;
}

/**
 * Repeat the authored program's days until they cover `days`, then cut there.
 *
 * Cloning, never sharing: the caller gives every returned day's sessions their
 * OWN rows, so a coach can make cycle three heavier than cycle one. Sharing rows
 * would make one edit rewrite every cycle at once, which is the opposite of how
 * a block is programmed.
 *
 * Each cycle's `weekIndex` is offset by the authored program's own week span, so
 * `(weekIndex, orderIndex)` keeps climbing across cycles — that pair IS the
 * date-walk's day position and the ordering every placed-plan reader uses.
 * Cycle 0 is returned with the authored coordinates untouched, so a program
 * placed once is byte-identical to what placement produced before blocks bounded
 * anything. A final partial cycle is cut mid-program: the block ends when it ends.
 */
export function expandProgramToWindow<T extends { weekIndex: number; orderIndex: number }>(
  authored: T[],
  days: number,
): T[] {
  if (authored.length === 0 || days <= 0) return [];

  const weeksPerCycle = Math.max(...authored.map((s) => s.weekIndex)) + 1;

  const expanded: T[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = authored[i % authored.length];
    const cycle = Math.floor(i / authored.length);
    expanded.push({ ...day, weekIndex: day.weekIndex + cycle * weeksPerCycle });
  }
  return expanded;
}

/**
 * The last day of one pass of a placed program: `startDate + max(1, dayCount) − 1`.
 * The length a placement asks for when no block stretches it. Nothing derives
 * an existing program's end from its rows any more — the end is on the row
 * (migration 167) and every reader takes it from there.
 */
export function placementEndDate(startDate: string, dayCount: number): string {
  return addDays(startDate, Math.max(1, dayCount) - 1);
}
