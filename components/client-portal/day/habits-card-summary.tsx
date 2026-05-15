import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";
import { getTodayDateString } from "@/lib/date-helpers";

type Props = {
  habits: { totalCount: number; loggedCount: number };
  date: string;
};

export function HabitsCardSummary({ habits, date }: Props) {
  if (habits.totalCount === 0) {
    return (
      <DsCardSummary title="Habits">
        <DsCardSummaryRow leadingText="No habits to track" />
      </DsCardSummary>
    );
  }

  const isFuture = date > getTodayDateString();
  const leadingText = `${habits.loggedCount} of ${habits.totalCount} logged`;
  const hint =
    habits.loggedCount === habits.totalCount ? "Tap to view" : "Tap to log";

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
