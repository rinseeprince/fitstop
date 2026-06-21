import { StickyNote } from "lucide-react";

import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";
import { getTodayDateString } from "@/lib/date-helpers";
import type { DaySummary } from "@/types/client-day";

type Props = {
  nutrition: DaySummary["nutrition"];
  date: string;
};

/** Card leading text: a logged day shows consumed vs target; an unlogged day shows the target to hit. */
function formatLeading(n: NonNullable<DaySummary["nutrition"]>): string {
  if (n.hasLog) {
    if (n.caloriesConsumed != null && n.targetCalories != null) {
      return `${n.caloriesConsumed.toLocaleString()} / ${n.targetCalories.toLocaleString()} kcal`;
    }
    if (n.caloriesConsumed != null) {
      return `${n.caloriesConsumed.toLocaleString()} kcal`;
    }
    return "Logged";
  }
  if (n.targetCalories != null) {
    return `Target ${n.targetCalories.toLocaleString()} kcal`;
  }
  return "Not logged yet";
}

export function NutritionCardSummary({ nutrition, date }: Props) {
  if (nutrition === null) {
    return (
      <DsCardSummary title="Nutrition">
        <DsCardSummaryRow leadingText="No nutrition target today" />
      </DsCardSummary>
    );
  }

  const isFuture = date > getTodayDateString();
  const leadingText = formatLeading(nutrition);
  const hint = nutrition.hasLog ? "Tap to view" : "Tap to log";

  return (
    <DsCardSummary title="Nutrition">
      <DsCardSummaryRow
        href={isFuture ? undefined : `/client/nutrition?date=${date}`}
        prefetch={false}
        leadingText={leadingText}
        hint={isFuture ? undefined : hint}
        ariaLabel={`Nutrition — ${leadingText}`}
      />
      {nutrition.note ? (
        <div className="flex items-start gap-1.5 text-xs text-foreground">
          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>{nutrition.note}</span>
        </div>
      ) : null}
    </DsCardSummary>
  );
}
