import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";
import { getTodayDateString } from "@/lib/date-helpers";
import type { HabitDaySummary } from "@/types/habits";

type Props = {
  /**
   * The habits a version covers on the day, those planned on it, how many of
   * those were done that day, and how many habit-days the day's week still
   * asks of the habits running that day.
   */
  habits: HabitDaySummary;
  date: string;
  /** The day rule leaves the day open: a locked day asks the client for nothing. */
  editable: boolean;
};

/**
 * The row's words: what the day asks of the client and how much of it is
 * done, or — on a day with nothing planned — what the week still asks, on a
 * line of its own under the first, so a narrow phone never cuts it off. The
 * home shows any date (/client?date=), so "today" and the week's to-do are
 * said on today alone; another day's words name no day, and a locked today
 * asks nothing more of its week.
 */
function rowWords(habits: HabitDaySummary, isToday: boolean, editable: boolean): { leading: string; trailing?: string } {
  if (habits.plannedToday > 0) {
    return { leading: `${habits.doneToday} of ${habits.plannedToday} done${isToday ? " today" : ""}` };
  }
  if (!isToday) return { leading: "Nothing planned" };
  return editable && habits.toDoThisWeek > 0
    ? { leading: "Nothing planned today", trailing: `${habits.toDoThisWeek} to do this week` }
    : { leading: "Nothing planned today" };
}

/** Whether the row's words ask the client for something still to do on the day. */
function asksForMore(habits: HabitDaySummary, isToday: boolean, editable: boolean): boolean {
  if (!editable) return false;
  if (habits.plannedToday > 0) return habits.doneToday < habits.plannedToday;
  return isToday && habits.toDoThisWeek > 0;
}

export function HabitsCardSummary({ habits, date, editable }: Props) {
  if (habits.running === 0) {
    return (
      <DsCardSummary title="Habits">
        <DsCardSummaryRow leadingText="No habits to track" />
      </DsCardSummary>
    );
  }

  const today = getTodayDateString();
  const isFuture = date > today;
  const isToday = date === today;
  const words = rowWords(habits, isToday, editable);
  const hint = asksForMore(habits, isToday, editable) ? "Tap to log" : "Tap to view";

  return (
    <DsCardSummary title="Habits">
      <DsCardSummaryRow
        href={isFuture ? undefined : `/client/habits?date=${date}`}
        prefetch={false}
        leadingText={words.leading}
        trailingText={words.trailing}
        hint={isFuture ? undefined : hint}
        ariaLabel={`Habits: ${words.leading}${words.trailing ? `, ${words.trailing}` : ""}`}
      />
    </DsCardSummary>
  );
}
