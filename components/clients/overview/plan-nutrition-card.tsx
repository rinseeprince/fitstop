"use client";

import { Utensils } from "lucide-react";
import {
  CardHeader,
  EmptyInvite,
  NeutralChip,
  OpenTabLink,
  OverviewCard,
  StatStrip,
  type StatCellData,
} from "./overview-primitives";
import { pluralize } from "./overview-format";
import type { OverviewPlanSummary } from "@/types/coach-overview";
import { useUnits } from "@/contexts/units-context";
import { KG_PER_LB } from "@/utils/unit-conversions";

type PlanNutritionCardProps = {
  nutrition: OverviewPlanSummary["nutrition"];
  onOpenNutrition: () => void;
};

function dietLabel(dietType: string): string {
  const spaced = dietType.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function PlanNutritionCard({ nutrition, onOpenNutrition }: PlanNutritionCardProps) {
  const { preference } = useUnits();
  if (!nutrition) {
    return (
      <OverviewCard animationDelay="0.14s">
        <EmptyInvite
          icon={<Utensils className="h-8 w-8" strokeWidth={1.5} />}
          title="No nutrition plan yet"
          hint="Build one so daily calorie and macro targets reach this client."
          actionLabel="Open Nutrition"
          onAction={onOpenNutrition}
        />
      </OverviewCard>
    );
  }

  const chips: string[] = [];
  if (nutrition.dietType) chips.push(dietLabel(nutrition.dietType));
  chips.push(nutrition.customMacros ? "Custom macros" : "Calculated");
  if (nutrition.proteinGPerKg !== null) {
    // Protein per unit of BODY WEIGHT, so it follows the viewer's unit.
    const perUnit = preference === "metric" ? "kg" : "lb";
    const perValue =
      preference === "metric"
        ? nutrition.proteinGPerKg
        : Number((nutrition.proteinGPerKg * KG_PER_LB).toFixed(2));
    chips.push(`${perValue} g/${perUnit}`);
  }

  const cells: StatCellData[] = [
    {
      label: "Rest day",
      value: String(nutrition.restDayCalories),
      unit: "cal",
      sub: `${pluralize(nutrition.restDaysThisWeek, "rest day")} this week`,
      subIsNumeric: true,
    },
    nutrition.trainDayCalories !== null
      ? {
          label: "Train day",
          value: String(nutrition.trainDayCalories),
          unit: "cal",
          sub:
            nutrition.surplusPct !== null
              ? `+${nutrition.surplusPct}% surplus`
              : "Same as rest day",
          subIsNumeric: nutrition.surplusPct !== null,
        }
      : { label: "Train day", value: null, sub: "No training days this week" },
    nutrition.today
      ? {
          label: "Today's target",
          value: String(nutrition.today.targetCalories),
          unit: "cal",
          sub:
            nutrition.today.loggedCalories !== null
              ? `${nutrition.today.loggedCalories} logged so far`
              : "Nothing logged yet",
          subIsNumeric: nutrition.today.loggedCalories !== null,
        }
      : { label: "Today's target", value: null, sub: "No target for today" },
  ];

  return (
    <OverviewCard animationDelay="0.14s">
      <CardHeader
        compact
        icon={<Utensils className="h-4 w-4" strokeWidth={1.5} />}
        title="Nutrition targets"
        subtitle={
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <NeutralChip key={chip}>{chip}</NeutralChip>
            ))}
          </div>
        }
        right={<OpenTabLink label="Open Nutrition" onClick={onOpenNutrition} />}
      />

      {/* Header, hairline, stat strip — structurally identical to the training
          card beside it, which is what makes the two strips line up. A macro
          row used to sit below this one, and because the pair stretch to the
          taller of them it pushed the training card's strip to the bottom of a
          card its own content did not fill. */}
      <div className="mt-auto border-t border-[rgba(13,148,136,0.06)]">
        <StatStrip cells={cells} />
      </div>
    </OverviewCard>
  );
}
