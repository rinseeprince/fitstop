"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import {
  shouldShowRegenerationBanner,
  getWeightChange,
  formatWeight,
  weightToKg,
} from "@/utils/nutrition-helpers";
import type { UnitPreference } from "@/types/check-in";

type NutritionRegenerationBannerProps = {
  currentWeight: number;
  weightUnit: "lbs" | "kg";
  nutritionPlanBaseWeightKg: number;
  nutritionPlanCreatedDate?: string;
  unitPreference?: UnitPreference;
  onRegenerate?: () => void;
  showRegenerateButton?: boolean;
};

export const NutritionRegenerationBanner = ({
  currentWeight,
  weightUnit,
  nutritionPlanBaseWeightKg,
  nutritionPlanCreatedDate,
  unitPreference = "imperial",
  onRegenerate,
  showRegenerateButton = true,
}: NutritionRegenerationBannerProps) => {
  const currentWeightKg = weightToKg(currentWeight, weightUnit);
  const showBanner = shouldShowRegenerationBanner(
    currentWeightKg,
    nutritionPlanBaseWeightKg
  );

  if (!showBanner) return null;

  const weightChange = getWeightChange(
    currentWeightKg,
    nutritionPlanBaseWeightKg,
    unitPreference
  );

  return (
    <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 space-y-3">
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                Client weight has changed significantly
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                Weight changed by{" "}
                <span className="font-semibold">
                  {weightChange.isLoss ? "-" : "+"}
                  {weightChange.value} {weightChange.unit}
                </span>{" "}
                since nutrition plan was created
                {nutritionPlanCreatedDate && (
                  <>
                    {" "}
                    on{" "}
                    <span className="font-medium">
                      {format(new Date(nutritionPlanCreatedDate), "MMM d, yyyy")}
                    </span>
                  </>
                )}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                {formatWeight(nutritionPlanBaseWeightKg, unitPreference)} →{" "}
                {formatWeight(currentWeightKg, unitPreference)}
              </p>
            </div>
            {showRegenerateButton && onRegenerate && (
              <Button
                onClick={onRegenerate}
                size="sm"
                className="w-full"
                variant="default"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate Nutrition Plan
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};
