import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";

type Props = {
  nutrition: { hasLog: boolean } | null;
  date: string;
};

export function NutritionCardSummary({ nutrition, date }: Props) {
  if (nutrition === null) {
    return (
      <DsCardSummary title="Nutrition">
        <DsCardSummaryRow leadingText="No nutrition target today" />
      </DsCardSummary>
    );
  }

  const leadingText = nutrition.hasLog ? "Logged" : "Not logged yet";
  const hint = nutrition.hasLog ? "Tap to view" : "Tap to log";

  return (
    <DsCardSummary title="Nutrition">
      <DsCardSummaryRow
        href={`/client/nutrition?date=${date}`}
        prefetch={false}
        leadingText={leadingText}
        hint={hint}
        ariaLabel={`Nutrition — ${leadingText}`}
      />
    </DsCardSummary>
  );
}
