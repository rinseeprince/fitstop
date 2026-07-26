"use client";

import { Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
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

type PlanNutritionCardProps = {
  nutrition: OverviewPlanSummary["nutrition"];
  onOpenNutrition: () => void;
};

// Teal-shifted macro palette (docs/newdesignsystem.md → Macro Colours).
const MACRO_DOTS = [
  { key: "proteinG", label: "Protein", color: "#2d8fb5" },
  { key: "carbG", label: "Carbs", color: "#c8923a" },
  { key: "fatG", label: "Fat", color: "#c06060" },
] as const;

function dietLabel(dietType: string): string {
  const spaced = dietType.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function PlanNutritionCard({ nutrition, onOpenNutrition }: PlanNutritionCardProps) {
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
  if (nutrition.proteinGPerKg !== null) chips.push(`${nutrition.proteinGPerKg} g/kg`);

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

      <div className="mt-auto border-t border-[rgba(13,148,136,0.06)]">
        <StatStrip cells={cells} />
        <div className="flex flex-wrap items-center gap-4 border-t border-[rgba(13,148,136,0.06)] px-5 py-3">
          {MACRO_DOTS.map((macro) => (
            <span key={macro.key} className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: macro.color }}
                aria-hidden
              />
              <span className="text-[10px] text-[#5a7d82]">{macro.label}</span>
              <span className={cn(MONO, "text-[11px] font-medium text-[#0c1a1e]")}>
                {nutrition.macros[macro.key]}g
              </span>
            </span>
          ))}
        </div>
      </div>
    </OverviewCard>
  );
}
