import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";
import { getTodayDateString } from "@/lib/date-helpers";
import type { HabitDaySummary } from "@/types/habits";

type Props = {
  /** The habits a version covers on the day, those planned on it, and how many of those were done that day. */
  habits: HabitDaySummary;
  date: string;
};

/** The words the row leads with: what the day asks of the client, and how much of it is done. */
function leading(habits: HabitDaySummary): string {
  if (habits.plannedToday === 0) return "Nothing planned";
  return `${habits.doneToday} of ${habits.plannedToday} done`;
}

export function HabitsCardSummary({ habits, date }: Props) {
  if (habits.running === 0) {
    return (
      <DsCardSummary title="Habits">
        <DsCardSummaryRow leadingText="No habits to track" />
      </DsCardSummary>
    );
  }

  const isFuture = date > getTodayDateString();
  const leadingText = leading(habits);
  const allDone = habits.plannedToday > 0 && habits.doneToday === habits.plannedToday;
  const hint = allDone || habits.plannedToday === 0 ? "Tap to view" : "Tap to log";

  return (
    <DsCardSummary title="Habits">
      <DsCardSummaryRow
        href={isFuture ? undefined : `/client/habits?date=${date}`}
        prefetch={false}
        leadingText={leadingText}
        hint={isFuture ? undefined : hint}
        ariaLabel={`Habits — ${leadingText}`}
      />
    </DsCardSummary>
  );
}
