import type { ProgramDraft, WeekDraft } from "./program-builder-types";

// The plan editor's one date rule. The grid's slots are the plan's days in
// order — slot i of the flattened weeks is the day effective_from + i — and a
// day can change only from the first editable day (the client's today, or
// tomorrow once they have logged a workout today) through the last day the
// plan may reach (its block's end, or the day before the next block or the
// next plan). Days before are history; days after are greyed and can't hold a
// session.
//
// The rule is applied by POSITION to the grid as it stands, because adding,
// removing or moving a week shifts every later day. React-free: the grid, the
// dnd gates, the provider's guarded mutators and the assistant's ops (the
// server executor and the client replay alike) all ask it.

/** The editable days, as positions from the plan's start. */
export type EditableDays = {
  /** The first editable day. */
  from: number;
  /** The last day the plan may reach; null when nothing bounds it. */
  through: number | null;
};

export const PAST_LOCKED =
  "That day is locked — it has already happened on the client's calendar";

export const LIMIT_LOCKED = "That day is greyed out — the plan can't reach it";

type WeekRules = { canDelete: boolean; canDuplicate: boolean; canReorder: boolean };

export type PlanDayRules = {
  /** Every slot the coach can't change: history and greyed days. */
  locked: ReadonlySet<string>;
  /** Slots whose day is history. */
  past: ReadonlySet<string>;
  /** Slots past the plan's last possible day. */
  beyond: ReadonlySet<string>;
  todaySlotUid: string | null;
  canAddWeek: boolean;
  weeks: ReadonlyMap<string, WeekRules>;
};

/** Whether any session sits on a day past `through`. */
function sessionPastLimit(weeks: WeekDraft[], through: number | null): boolean {
  if (through == null) return false;
  let position = 0;
  for (const week of weeks) {
    for (const slot of week.days) {
      if (slot.session && position > through) return true;
      position += 1;
    }
  }
  return false;
}

function insertWeek(weeks: WeekDraft[], at: number, week: WeekDraft): WeekDraft[] {
  return [...weeks.slice(0, at), week, ...weeks.slice(at)];
}

function moveWeek(weeks: WeekDraft[], from: number, to: number): WeekDraft[] {
  const next = [...weeks];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The last week holding a history day; -1 when none does. */
function historyBoundary(weeks: WeekDraft[], days: EditableDays): number {
  return days.from <= 0 ? -1 : Math.min(weeks.length - 1, Math.floor((days.from - 1) / 7));
}

export function planDayRules(
  weeks: WeekDraft[],
  days: EditableDays,
  todayPosition: number | null,
): PlanDayRules {
  const past = new Set<string>();
  const beyond = new Set<string>();
  let todaySlotUid: string | null = null;
  let position = 0;
  for (const week of weeks) {
    for (const slot of week.days) {
      if (position < days.from) past.add(slot.uid);
      else if (days.through != null && position > days.through) beyond.add(slot.uid);
      if (position === todayPosition) todaySlotUid = slot.uid;
      position += 1;
    }
  }
  const locked = new Set([...past, ...beyond]);

  const rules = new Map<string, WeekRules>();
  weeks.forEach((week, index) => {
    rules.set(week.uid, {
      // Removing a week moves every later day earlier — never a day of history.
      canDelete: !week.days.some((slot) => past.has(slot.uid)),
      // A copy lands right after the week and pushes the later weeks on.
      canDuplicate: insertWeekRefusal(weeks, days, index, week) == null,
      canReorder: !week.days.some((slot) => locked.has(slot.uid)),
    });
  });

  return {
    locked,
    past,
    beyond,
    todaySlotUid,
    // A new week's first day must be one the plan can reach.
    canAddWeek: days.through == null || weeks.length * 7 <= days.through,
    weeks: rules,
  };
}

/** Why a slot is locked, in the words a refusal shows; null when it isn't. */
export function slotRefusal(rules: PlanDayRules, slotUid: string): string | null {
  if (rules.past.has(slotUid)) return PAST_LOCKED;
  return rules.beyond.has(slotUid) ? LIMIT_LOCKED : null;
}

/** Why a session's day is locked; null when it isn't, or the session is gone. */
export function sessionRefusal(
  draft: ProgramDraft,
  rules: PlanDayRules,
  sessionUid: string,
): string | null {
  for (const week of draft.weeks) {
    for (const slot of week.days) {
      if (slot.session?.uid === sessionUid) return slotRefusal(rules, slot.uid);
    }
  }
  return null;
}

/** A session is locked iff the slot holding it is locked. Vanished → false. */
export function isSessionLocked(
  draft: ProgramDraft,
  locked: ReadonlySet<string>,
  sessionUid: string,
): boolean {
  for (const week of draft.weeks) {
    for (const slot of week.days) {
      if (slot.session?.uid === sessionUid) return locked.has(slot.uid);
    }
  }
  return false;
}

/**
 * Why `week` can't be inserted after `afterIndex`; null when it can. An
 * insert shifts every later week, so it lands only after the last week of
 * history, only on a week that starts on a day the plan can reach (the Add
 * week rule), and only when no session is pushed past the plan's last day.
 */
export function insertWeekRefusal(
  weeks: WeekDraft[],
  days: EditableDays,
  afterIndex: number,
  week: WeekDraft,
): string | null {
  if (afterIndex < historyBoundary(weeks, days)) return PAST_LOCKED;
  if (days.through != null && (afterIndex + 1) * 7 > days.through) return LIMIT_LOCKED;
  return sessionPastLimit(insertWeek(weeks, afterIndex + 1, week), days.through)
    ? LIMIT_LOCKED
    : null;
}

/**
 * Why the week at `fromIndex` can't move to `toIndex`; null when it can. Both
 * ends must sit after the last week of history — moving a week of history, or
 * landing on or before one, would re-date it — and no session may land past
 * the plan's last day.
 */
export function moveWeekRefusal(
  weeks: WeekDraft[],
  days: EditableDays,
  fromIndex: number,
  toIndex: number,
): string | null {
  const boundary = historyBoundary(weeks, days);
  if (fromIndex <= boundary || toIndex <= boundary) return PAST_LOCKED;
  return sessionPastLimit(moveWeek(weeks, fromIndex, toIndex), days.through)
    ? LIMIT_LOCKED
    : null;
}
