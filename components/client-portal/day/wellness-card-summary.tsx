import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";

type Props = {
  wellness: { hasLog: boolean };
  date: string;
};

export function WellnessCardSummary({ wellness, date }: Props) {
  const leadingText = wellness.hasLog ? "Logged" : "Not logged yet";
  const hint = wellness.hasLog ? "Tap to view" : "Tap to log";

  return (
    <DsCardSummary title="Wellness">
      <DsCardSummaryRow
        href={`/client/wellness?date=${date}`}
        prefetch={false}
        leadingText={leadingText}
        hint={hint}
        ariaLabel={`Wellness — ${leadingText}`}
      />
    </DsCardSummary>
  );
}
