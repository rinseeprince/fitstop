import { supabaseAdmin } from "./supabase-admin";
import { getNextPlanStartCap } from "./training-event-service";
import { getBlockBoundForDate } from "./client-blocks-service";
import { getDateString } from "@/lib/date-helpers";
import type { TrainingEventInsert } from "@/lib/database-helpers";

// The ordered program the date-walk maps onto calendar dates. One entry per
// authored slot (training AND rest), referencing the placed training_sessions
// row id.
/** `date + n` days, as a YYYY-MM-DD string. */
function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  return getDateString(d);
}

export type ProgramSlot = {
  id: string;
  isRest: boolean;
  name: string;
  focus: string | null;
  calorieSurplusPercentage: number | null;
  estimatedCalories: number | null;
};

/**
 * Generate training events by walking calendar dates through the ordered program
 * slots — a sequential date-walk over the whole authored program. Each calendar
 * day maps to programSlots[slotPosition]; a rest slot advances the position but
 * emits NO event, so a rest day never spawns a training_event (it still consumes
 * its date). Each slot references a distinct cloned session id and the
 * (client, session, date) upsert is idempotent.
 */
export async function generateProgramEvents(params: {
  clientId: string;
  planId: string;
  programSlots: ProgramSlot[];
  startDate: string;
  endDate: string;
}): Promise<number> {
  const { clientId, planId, programSlots, startDate, endDate } = params;

  const slotCount = programSlots.length;
  if (slotCount === 0) return 0;

  const rows: TrainingEventInsert[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  let slotPosition = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const slot = programSlots[slotPosition];
    if (!slot.isRest) {
      rows.push({
        client_id: clientId,
        training_plan_id: planId,
        training_session_id: slot.id,
        date: getDateString(d),
        session_name: slot.name,
        session_focus: slot.focus ?? null,
        estimated_calories: slot.estimatedCalories ?? null,
        calorie_surplus_percentage: slot.calorieSurplusPercentage ?? null,
        status: "scheduled",
        is_modified: false,
      });
    }
    // Every caller lays exactly as many slots as its window has days, so the
    // walk cannot run off the end; the modulo is a cheap guard.
    slotPosition = (slotPosition + 1) % slotCount;
  }

  if (rows.length === 0) return 0;

  const { error } = await supabaseAdmin
    .from("training_events")
    .upsert(rows, {
      onConflict: "client_id,training_session_id,date",
      ignoreDuplicates: true,
    });

  if (error) throw new Error(`Failed to generate events: ${error.message}`);

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
  slotCount: number;
  startDate: string;
}): Promise<string> {
  const { clientId, slotCount, startDate } = params;
  const { stretchesToCap, cap } = await resolveWindowCap(clientId, startDate);
  const ownEnd = placementEndDate(startDate, slotCount);
  if (stretchesToCap && cap) return cap.endsOn;
  return cap && cap.endsOn < ownEnd ? cap.endsOn : ownEnd;
}

/**
 * Repeat the authored program until it covers `days`, then cut it there.
 *
 * Cloning, never sharing: the caller gives every returned slot its OWN row, so a
 * coach can make cycle three heavier than cycle one. Sharing rows would make one
 * edit rewrite every cycle at once, which is the opposite of how a block is
 * programmed.
 *
 * Each cycle's `weekIndex` is offset by the authored program's own week span, so
 * `(weekIndex, orderIndex)` keeps climbing across cycles — that pair IS the
 * date-walk's slot position and the ordering every placed-plan reader uses.
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
    const slot = authored[i % authored.length];
    const cycle = Math.floor(i / authored.length);
    expanded.push({ ...slot, weekIndex: slot.weekIndex + cycle * weeksPerCycle });
  }
  return expanded;
}

/**
 * The last day of one pass of a placed program: `startDate + max(1, slotCount) − 1`.
 * The length a placement asks for when no block stretches it. Nothing derives
 * an existing program's end from its rows any more — the end is on the row
 * (migration 167) and every reader takes it from there.
 */
export function placementEndDate(startDate: string, slotCount: number): string {
  return addDays(startDate, Math.max(1, slotCount) - 1);
}
