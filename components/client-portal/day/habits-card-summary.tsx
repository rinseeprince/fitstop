import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";

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

  const leadingText = `${habits.loggedCount} of ${habits.totalCount} logged`;
  const hint =
    habits.loggedCount === habits.totalCount ? "Tap to view" : "Tap to log";

  return (
    <DsCardSummary title="Habits">
      <DsCardSummaryRow
        href={`/client/habits?date=${date}`}
        prefetch={false}
        leadingText={leadingText}
        hint={hint}
        ariaLabel={`Habits — ${leadingText}`}
      />
    </DsCardSummary>
  );
}
