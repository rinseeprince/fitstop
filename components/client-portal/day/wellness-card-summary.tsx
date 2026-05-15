import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";
import { getTodayDateString } from "@/lib/date-helpers";

type Props = {
  wellness: { hasLog: boolean };
  date: string;
};

export function WellnessCardSummary({ wellness, date }: Props) {
  const isFuture = date > getTodayDateString();
  const leadingText = wellness.hasLog ? "Logged" : "Not logged yet";
  const hint = wellness.hasLog ? "Tap to view" : "Tap to log";

  return (
    <DsCardSummary title="Wellness">
      <DsCardSummaryRow
        href={isFuture ? undefined : `/client/wellness?date=${date}`}
        prefetch={false}
        leadingText={leadingText}
        hint={isFuture ? undefined : hint}
        ariaLabel={`Wellness — ${leadingText}`}
      />
    </DsCardSummary>
  );
}
