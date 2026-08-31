"use client";

import { AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { shouldShowRegenerationBanner } from "@/utils/nutrition-helpers";
import { useUnits } from "@/contexts/units-context";
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";

// Body weights and a body-weight delta: formatWeight, which converts freely.
const show = (valueKg: number, viewer: UnitSystem): string => {
  const { value, unit } = formatWeight(valueKg, viewer);
  return `${value.toFixed(1)} ${unit}`;
};

type NutritionRegenerationBannerProps = {
  /** KILOGRAMS — canonical since migration 141, so no conversion happens here. */
  currentWeight: number;
  nutritionPlanBaseWeightKg: number;
  nutritionPlanEffectiveDate?: string;
};

export const NutritionRegenerationBanner = ({
  currentWeight,
  nutritionPlanBaseWeightKg,
  nutritionPlanEffectiveDate,
}: NutritionRegenerationBannerProps) => {
  // The CLIENT's preference used to arrive as a prop; a coach sees their own.
  const { preference } = useUnits();
  const currentWeightKg = currentWeight;
  const showBanner = shouldShowRegenerationBanner(
    currentWeightKg,
    nutritionPlanBaseWeightKg
  );

  if (!showBanner) return null;

  const changeKg = currentWeightKg - nutritionPlanBaseWeightKg;
  const weightChange = {
    ...formatWeight(Math.abs(changeKg), preference),
    isLoss: changeKg < 0,
  };

  return (
    <div className="rounded-[6px] bg-[rgba(245,158,11,0.07)] p-5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[rgba(245,158,11,0.12)] flex items-center justify-center flex-shrink-0">
          <AlertCircle className="h-4 w-4 text-[#d97706]" strokeWidth={1.5} />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-[#0c1a1e]">
              Client weight has changed significantly
            </p>
            <p className="text-sm text-[#5a7d82] mt-1">
              Weight changed by{" "}
              <span className="font-semibold text-[#0c1a1e]">
                {weightChange.isLoss ? "-" : "+"}
                {weightChange.value} {weightChange.unit}
              </span>{" "}
              since these targets took effect
              {nutritionPlanEffectiveDate && (
                <>
                  {" "}
                  on{" "}
                  <span className="font-medium text-[#0c1a1e]">
                    {format(new Date(nutritionPlanEffectiveDate), "MMM d, yyyy")}
                  </span>
                </>
              )}
            </p>
            <p className="text-xs text-[#93b0b4] mt-1">
              {show(nutritionPlanBaseWeightKg, preference)} →{" "}
              {show(currentWeightKg, preference)}
            </p>
          </div>
          <p className="text-xs font-medium text-[#d97706]">
            Consider reviewing their nutrition plan.
          </p>
        </div>
      </div>
    </div>
  );
};
