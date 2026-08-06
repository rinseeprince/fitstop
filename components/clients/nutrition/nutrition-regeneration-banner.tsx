"use client";

import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
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
  nutritionPlanCreatedDate?: string;
  onRegenerate?: () => void;
  showRegenerateButton?: boolean;
};

export const NutritionRegenerationBanner = ({
  currentWeight,
  nutritionPlanBaseWeightKg,
  nutritionPlanCreatedDate,
  onRegenerate,
  showRegenerateButton = true,
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
    <div className="bg-warning/10 rounded-lg p-5 border border-warning/20">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="h-4 w-4 text-warning" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Client weight has changed significantly
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Weight changed by{" "}
              <span className="font-semibold text-foreground">
                {weightChange.isLoss ? "-" : "+"}
                {weightChange.value} {weightChange.unit}
              </span>{" "}
              since nutrition plan was created
              {nutritionPlanCreatedDate && (
                <>
                  {" "}
                  on{" "}
                  <span className="font-medium text-foreground">
                    {format(new Date(nutritionPlanCreatedDate), "MMM d, yyyy")}
                  </span>
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {show(nutritionPlanBaseWeightKg, preference)} →{" "}
              {show(currentWeightKg, preference)}
            </p>
          </div>
          {showRegenerateButton && onRegenerate && (
            <Button
              onClick={onRegenerate}
              size="sm"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-all"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Regenerate Nutrition Plan
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
