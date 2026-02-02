"use client";

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
    <div className="bg-warning/10 rounded-xl p-5 border border-warning/20">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="h-4 w-4 text-amber-600" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-900">
              Client weight has changed significantly
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Weight changed by{" "}
              <span className="font-semibold text-gray-900">
                {weightChange.isLoss ? "-" : "+"}
                {weightChange.value} {weightChange.unit}
              </span>{" "}
              since nutrition plan was created
              {nutritionPlanCreatedDate && (
                <>
                  {" "}
                  on{" "}
                  <span className="font-medium text-gray-900">
                    {format(new Date(nutritionPlanCreatedDate), "MMM d, yyyy")}
                  </span>
                </>
              )}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {formatWeight(nutritionPlanBaseWeightKg, unitPreference)} →{" "}
              {formatWeight(currentWeightKg, unitPreference)}
            </p>
          </div>
          {showRegenerateButton && onRegenerate && (
            <Button
              onClick={onRegenerate}
              size="sm"
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg shadow-sm hover:shadow transition-all"
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
