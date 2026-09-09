import { supabaseAdmin } from "./supabase-admin";
import { getNextPlanStartCap } from "./training-event-service";
import { getBlockEndCoveringDate } from "./client-blocks-service";
import { rethrowIfAnyDateOccupied } from "./training-event-occupancy";
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
 *
 * `startPosition` resumes the walk mid-program: the first calendar date maps to
 * programSlots[startPosition]. A plan amendment re-walks only the future window
 * (startDate = the today floor) while keeping every elapsed slot's date
 * arithmetic intact — slotPosition = daysBetween(effective_from, date).
 *
 * `skipPositions` are slots whose day is already accounted for by an event the
 * caller is deliberately preserving — the amendment's frozen positions, where a
 * session the client logged early keeps its original row. Relying on the upsert
 * arbiter instead would be wrong for a preserved event that has been MOVED: its
 * date no longer matches its slot's, nothing conflicts, and the session would be
 * written a second time on the slot's own day.
 */
export async function generateProgramEvents(params: {
  clientId: string;
  planId: string;
  programSlots: ProgramSlot[];
  startDate: string;
  endDate: string;
  startPosition?: number;
  skipPositions?: ReadonlySet<number>;
}): Promise<number> {
  const { clientId, planId, programSlots, startDate, endDate, startPosition, skipPositions } =
    params;

  const slotCount = programSlots.length;
  if (slotCount === 0) return 0;

  const rows: TrainingEventInsert[] = [];
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  let slotPosition = startPosition ?? 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const slot = programSlots[slotPosition];
    if (!slot.isRest && !skipPositions?.has(slotPosition)) {
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
    // The window never exceeds the program length (calculatePlacementEndDate),
    // so the walk cannot run off the end; the modulo is a cheap guard.
    slotPosition = (slotPosition + 1) % slotCount;
  }

  if (rows.length === 0) return 0;

  const { error } = await supabaseAdmin
    .from("training_events")
    .upsert(rows, {
      onConflict: "client_id,training_session_id,date",
      ignoreDuplicates: true,
    });

  if (error) {
    // The arbiter above does NOT cover migration 136's one-scheduled-per-day
    // index, so a collision there arrives as a raw 23505. Both callers clear
    // their window of scheduled events first, which is why neither pre-checks
    // with assertDateFree — but a concurrent write between that clear and this
    // upsert can still land one, and a coach must never read Postgres.
    rethrowIfAnyDateOccupied(error);
    throw new Error(`Failed to generate events: ${error.message}`);
  }

  return rows.length;
}

/**
 * How far a NEW placement from `startDate` should run — the block's last day
 * when a block covers that date, else the program's own authored length.
 * Capped, either way, at the day before the next coexisting program starts.
 *
 * **A different question from `calculatePlacementEndDate` below**, and the two
 * must not be merged. This one DECIDES a window for a placement that does not
 * exist yet; that one DESCRIBES where an existing placement ends, from the rows
 * it actually has. They agree for anything placed after this shipped, because
 * the rows are cloned to fill exactly this window — and they deliberately
 * disagree for a program placed before its block existed, or one whose block
 * was re-dated afterwards, where the ROWS are the truth and a block edit is
 * still allowed to write nothing.
 *
 * The block is not a maximum here: a block LONGER than the program stretches
 * the window and the caller repeats the program to fill it, a block SHORTER
 * truncates it. A placement on a day no block covers behaves exactly as it did
 * before blocks bounded anything.
 */
export async function resolvePlacementWindowEnd(params: {
  clientId: string;
  slotCount: number;
  startDate: string;
}): Promise<string> {
  const { clientId, slotCount, startDate } = params;

  const blockEnd = await getBlockEndCoveringDate(clientId, startDate);
  const end = blockEnd ?? addDays(startDate, Math.max(1, slotCount) - 1);

  const nextPlanCap = await getNextPlanStartCap(clientId, startDate);
  if (nextPlanCap && nextPlanCap < end) return nextPlanCap;
  return end;
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
 * The arithmetic half of `calculatePlacementEndDate`, exported on its own for
 * readers that already know the next plan's start and cap in memory (the
 * attention feed's cross-client read), so a program's end is spelled once.
 */
export function placementEndDate(startDate: string, slotCount: number): string {
  return addDays(startDate, Math.max(1, slotCount) - 1);
}

/**
 * Calculate the placement window end date. The authored program length is the
 * ONLY length knob: the whole-program slot count in days, placed exactly once.
 * There is deliberately no programDurationWeeks or 8-week fallback. The start
 * of the next coexisting plan is a MAXIMUM cap only (a program never runs past
 * it and never stretches to fill it).
 */
export async function calculatePlacementEndDate(params: {
  clientId: string;
  slotCount: number;
  startDate: string;
}): Promise<string> {
  const { clientId, slotCount, startDate } = params;

  const computedEnd = placementEndDate(startDate, slotCount);

  // Additive placement: never let this plan's window bleed past the start of a
  // later coexisting plan.
  const nextPlanCap = await getNextPlanStartCap(clientId, startDate);
  if (nextPlanCap && nextPlanCap < computedEnd) return nextPlanCap;
  return computedEnd;
}
