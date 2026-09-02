import { addDaysToDateString } from "@/lib/date-helpers";
import type {
  ClientLayoutMove,
  ClientTrainingWeek,
  ClientTrainingWeekSession,
} from "@/types/client-training-week";

// =============================================================================
// The week view's arithmetic: what does the client's week look like with their
// unsaved moves applied, and what is the ONE layout write that would make it so?
//
// Pure, for the same reason lib/session-pick.ts is: the Program tab's week
// view and its tests share one answer, and React Native can carry the same
// rule. The rules are the owner's (2026-08-26):
//   * a client rearranges their own week freely — any session that is still
//     scheduled can go on any day of the week it currently sits in;
//   * two sessions may share a day WHILE the client is rearranging (that is
//     how a swap is made: A onto B's day, then B onto A's old day), but never
//     be saved that way — Save stays disabled until every day holds at most
//     one session, whatever its status, which is also the server's occupancy
//     rule, so a stack on a logged or skipped day can only be undone;
//   * a logged or skipped session never moves;
//   * everything else is the server's call (a past day that already holds a
//     logged workout, drift since the week was read) and comes back as a
//     sentence to show.
// =============================================================================

/** Unsaved moves: eventId → the day the client put it on. */
export type WeekPlacements = Readonly<Record<string, string>>;

export type WeekLayoutEntry = {
  session: ClientTrainingWeekSession;
  /** The day the session was read on, when the client has moved it; null while it sits where it was. */
  pendingFrom: string | null;
};

type WeekLayoutDay = {
  date: string; // YYYY-MM-DD
  isToday: boolean;
  isPast: boolean;
  entries: WeekLayoutEntry[];
};

type WeekLayout = {
  days: WeekLayoutDay[]; // always seven, weekStart first
  /** The write that makes the week look like `days`: one entry per session whose day changed. */
  moves: ClientLayoutMove[];
  /** Days holding more than one session (any status). Nothing can be saved while one exists. */
  conflictDates: string[];
  isDirty: boolean;
  canSave: boolean;
};

const DAYS_IN_WEEK = 7;

export function buildWeekLayout(week: ClientTrainingWeek, placements: WeekPlacements): WeekLayout {
  const dates = Array.from({ length: DAYS_IN_WEEK }, (_, i) =>
    addDaysToDateString(week.weekStart, i),
  );
  const entriesByDate = new Map<string, WeekLayoutEntry[]>(dates.map((date) => [date, []]));
  const moves: ClientLayoutMove[] = [];

  for (const session of week.sessions) {
    // The contract puts every session inside the week; a row outside it is not
    // this week's business and must not invent an eighth day.
    if (!entriesByDate.has(session.date)) continue;

    // Only a still-scheduled session moves, and only inside this week — the
    // view offers nothing else, so this guards a placement that outlived a
    // refetch (the session was logged since, or the week rolled over).
    const placed = placements[session.eventId];
    const target =
      session.isScheduled && placed !== undefined && entriesByDate.has(placed)
        ? placed
        : session.date;
    const pendingFrom = target === session.date ? null : session.date;

    entriesByDate.get(target)?.push({ session, pendingFrom });
    if (pendingFrom !== null) {
      // fromDate is the day the client READ the session on — the drift check.
      moves.push({ eventId: session.eventId, fromDate: session.date, toDate: target });
    }
  }

  // A day lists what was already on it first, then what the client moved in —
  // the resident stays put on screen and the newcomer appears beneath it.
  const days: WeekLayoutDay[] = dates.map((date) => ({
    date,
    isToday: date === week.today,
    isPast: date < week.today,
    entries: (entriesByDate.get(date) ?? []).sort(
      (a, b) => Number(a.pendingFrom !== null) - Number(b.pendingFrom !== null),
    ),
  }));
  const conflictDates = days.filter((day) => day.entries.length > 1).map((day) => day.date);

  return {
    days,
    moves,
    conflictDates,
    isDirty: moves.length > 0,
    canSave: moves.length > 0 && conflictDates.length === 0,
  };
}
