import { getDateDaysFrom } from "@/lib/date-helpers";
import type { ProgramDraft, WeekDraft } from "./program-builder-types";

// ONE lock source for the placed-plan (amendment) target. Locks derive from a
// serializable `lockedSlotUids: string[]` plus the draft — computed once at
// seed time and shared by grid rendering, dnd gating, the provider's wrapped
// mutators, and applyDraftOp's ctx (server executor and client replay build
// the same Set from the same array, so the two sides cannot drift).
//
// Lock rule per slot position — a slot is locked when its day is already
// history, by any of three routes:
//   1. slotDate(position) < clientToday          — the day itself has passed
//   2. a linked event is no longer 'scheduled'   — the client logged it early
//   3. a linked event is DATED before today      — the coach moved it forward
//                                                  and the calendar overtook it
// slotDate(position) = effective_from + position days — the same arithmetic the
// placement date-walk uses, so a locked slot is exactly one whose calendar day
// the amendment writer will not touch. `amendPlacedPlanFuture` derives its
// frozen positions from the same three clauses against live DB state; the two
// MUST agree, because a slot the editor locks and the writer replaces is how the
// plan ended up with two active rows claiming one day.
//
// Route 3 is the only one that can lock a slot sitting in a FUTURE column, so it
// gets its own explanation — see MOVED_PAST_LOCKED.
//
// Because dates are contiguous, weeks before the boundary are fully locked and
// weeks after it fully open; only boundary weeks are partial (an early-logged
// future event can create a second partial week later on — the boundary is the
// LAST week containing any locked slot, conservatively).
//
// React-free: importable from API routes, the assistant workspace, and the
// state hook alike.

export const PAST_LOCKED =
  "That day is locked — it has already happened on the client's calendar";

/**
 * Route 3's explanation. A slot locked this way sits in a column whose own date
 * is still ahead, so "that day has already happened" would read as a bug — what
 * happened is the session, on the earlier date it was moved to.
 */
export const MOVED_PAST_LOCKED =
  "That session is locked — it was moved to a day that has already passed";

// Structural subset of the amendment GET the lock computation needs. Position i
// in the flattened draft maps to sessions[i] (canonical order); tail rest
// padding added by the flat regroup has no backing entry and locks by date
// alone.
export type PlacedPlanLockSource = {
  plan: { effectiveFrom: string };
  clientToday: string;
  sessions: Array<{ events: Array<{ status: string; date: string }> }>;
};

function slotLockRoutes(
  source: PlacedPlanLockSource,
  position: number,
  slotDate: string,
): { locked: boolean; movedPast: boolean } {
  const backing = source.sessions[position];
  const events = backing?.events ?? [];
  const dayPassed = slotDate < source.clientToday;
  const notScheduled = events.some((e) => e.status !== "scheduled");
  const movedPast = events.some((e) => e.date < source.clientToday);
  return {
    locked: dayPassed || notScheduled || movedPast,
    // Only worth a distinct message when the slot's own column is still ahead.
    movedPast: movedPast && !dayPassed,
  };
}

export function computeLockedSlotUids(
  source: PlacedPlanLockSource,
  weeks: WeekDraft[],
): string[] {
  const start = new Date(source.plan.effectiveFrom + "T00:00:00");
  const locked: string[] = [];
  let position = 0;
  for (const week of weeks) {
    for (const slot of week.days) {
      const slotDate = getDateDaysFrom(start, position);
      if (slotLockRoutes(source, position, slotDate).locked) locked.push(slot.uid);
      position += 1;
    }
  }
  return locked;
}

/**
 * The subset of locked slots whose own day is still in the future — locked only
 * because their session was moved to a date that has since passed. Presentation
 * only; the lock set itself is `computeLockedSlotUids` and stays the one
 * serialized contract the assistant and the writer share.
 */
export function computeMovedPastSlotUids(
  source: PlacedPlanLockSource,
  weeks: WeekDraft[],
): string[] {
  const start = new Date(source.plan.effectiveFrom + "T00:00:00");
  const movedPast: string[] = [];
  let position = 0;
  for (const week of weeks) {
    for (const slot of week.days) {
      const slotDate = getDateDaysFrom(start, position);
      if (slotLockRoutes(source, position, slotDate).movedPast) movedPast.push(slot.uid);
      position += 1;
    }
  }
  return movedPast;
}

export function isSlotLocked(
  lockedSlotUids: ReadonlySet<string>,
  slotUid: string,
): boolean {
  return lockedSlotUids.has(slotUid);
}

/** A session is locked iff the slot holding it is locked. Vanished → false. */
export function isSessionLocked(
  draft: ProgramDraft,
  lockedSlotUids: ReadonlySet<string>,
  sessionUid: string,
): boolean {
  for (const week of draft.weeks) {
    for (const slot of week.days) {
      if (slot.session?.uid === sessionUid) return lockedSlotUids.has(slot.uid);
    }
  }
  return false;
}

export function weekLockState(
  week: WeekDraft,
  lockedSlotUids: ReadonlySet<string>,
): "none" | "partial" | "full" {
  const lockedCount = week.days.filter((slot) => lockedSlotUids.has(slot.uid)).length;
  if (lockedCount === 0) return "none";
  return lockedCount === week.days.length ? "full" : "partial";
}

/** Index of the LAST week containing any locked slot; -1 when nothing is locked. */
export function lockBoundaryWeekIndex(
  weeks: WeekDraft[],
  lockedSlotUids: ReadonlySet<string>,
): number {
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weekLockState(weeks[i], lockedSlotUids) !== "none") return i;
  }
  return -1;
}

/** Deleting a week is allowed only when none of its days are history. */
export function canDeleteWeek(
  week: WeekDraft,
  lockedSlotUids: ReadonlySet<string>,
): boolean {
  return weekLockState(week, lockedSlotUids) === "none";
}

/**
 * Duplicating (or progressing) a week is allowed unless the week is fully
 * elapsed (decision 8) — the boundary week's remaining days are still worth
 * copying forward.
 */
export function canDuplicateWeek(
  week: WeekDraft,
  lockedSlotUids: ReadonlySet<string>,
): boolean {
  return weekLockState(week, lockedSlotUids) !== "full";
}

/**
 * Inserting after week `afterIndex` shifts every later week's dates — legal
 * only at/after the lock boundary, so no locked slot ever changes position.
 * (Appending at the end passes trivially: afterIndex = weeks.length - 1.)
 */
export function canInsertAfterWeek(
  weeks: WeekDraft[],
  lockedSlotUids: ReadonlySet<string>,
  afterIndex: number,
): boolean {
  return afterIndex >= lockBoundaryWeekIndex(weeks, lockedSlotUids);
}

/**
 * A week may move only when BOTH endpoints sit strictly after the boundary —
 * moving a locked week, or landing on/before one, would re-date history.
 */
export function canReorderWeeks(
  weeks: WeekDraft[],
  lockedSlotUids: ReadonlySet<string>,
  fromIndex: number,
  toIndex: number,
): boolean {
  const boundary = lockBoundaryWeekIndex(weeks, lockedSlotUids);
  return fromIndex > boundary && toIndex > boundary;
}
