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
// rule. The rules are the owner's (2026-08-26, 2026-09-16):
//   * a client rearranges their own week freely — any session that is still
//     scheduled can go on any day of the week it currently sits in;
//   * a day can hold several sessions, each its own workout: a session moved
//     onto a day joins it after the sessions already there, sessions moved
//     onto one day in the order the client moved them — the order the server
//     lands them in — so a swap is two moves;
//   * a logged or skipped session never moves;
//   * everything else is the server's call (drift since the week was read, a
//     week a check-in has closed) and comes back as a sentence to show.
// =============================================================================

/**
 * Unsaved moves: eventId → the day the client put it on, in the order the
 * client moved them — a session put down again goes last (its key re-added).
 */
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
  /** The day's sessions in order: those already on it, then those moved onto it. */
  entries: WeekLayoutEntry[];
};

type WeekLayout = {
  days: WeekLayoutDay[]; // always seven, weekStart first
  /**
   * The write that makes the week look like `days`: one entry per session
   * whose day changed, day by day and each day's arrivals in their order.
   */
  moves: ClientLayoutMove[];
  isDirty: boolean;
};

const DAYS_IN_WEEK = 7;

export function buildWeekLayout(week: ClientTrainingWeek, placements: WeekPlacements): WeekLayout {
  const dates = Array.from({ length: DAYS_IN_WEEK }, (_, i) =>
    addDaysToDateString(week.weekStart, i),
  );
  const staying = new Map<string, WeekLayoutEntry[]>(dates.map((date) => [date, []]));
  const arriving = new Map<string, WeekLayoutEntry[]>(dates.map((date) => [date, []]));
  const moveOrder = new Map(Object.keys(placements).map((eventId, i) => [eventId, i]));

  for (const session of week.sessions) {
    // The contract puts every session inside the week; a row outside it is not
    // this week's business and must not invent an eighth day.
    if (!staying.has(session.date)) continue;

    // Only a still-scheduled session moves, and only inside this week — the
    // view offers nothing else, so this guards a placement that outlived a
    // refetch (the session was logged since, or the week rolled over).
    const placed = placements[session.eventId];
    const target =
      session.isScheduled && placed !== undefined && staying.has(placed) ? placed : session.date;

    if (target === session.date) {
      staying.get(target)?.push({ session, pendingFrom: null });
    } else {
      arriving.get(target)?.push({ session, pendingFrom: session.date });
    }
  }

  // The week read comes in the calendar's order, so the sessions staying on a
  // day are already in the day's order; the arrivals follow in the order the
  // client moved them.
  const days: WeekLayoutDay[] = dates.map((date) => ({
    date,
    isToday: date === week.today,
    isPast: date < week.today,
    entries: [
      ...(staying.get(date) ?? []),
      ...(arriving.get(date) ?? []).sort(
        (a, b) =>
          (moveOrder.get(a.session.eventId) ?? 0) - (moveOrder.get(b.session.eventId) ?? 0),
      ),
    ],
  }));

  // fromDate is the day the client READ the session on — the drift check.
  const moves: ClientLayoutMove[] = days.flatMap((day) =>
    day.entries
      .filter((entry) => entry.pendingFrom !== null)
      .map((entry) => ({
        eventId: entry.session.eventId,
        fromDate: entry.session.date,
        toDate: day.date,
      })),
  );

  return { days, moves, isDirty: moves.length > 0 };
}
