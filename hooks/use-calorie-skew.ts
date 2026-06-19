"use client";

import { useState, useCallback } from "react";
import {
  validateWeeklyBudget,
  initializeDayOverridesFromTargets,
  calculateDailyMacros,
  type WeeklyBudgetValidation,
  type DayOfWeek,
} from "@/utils/nutrition-helpers";
import type { DayCalorieOverrides, DietType } from "@/types/check-in";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";

type UseCalorieSkewProps = {
  weeklyTargets: DailyNutritionTargets[] | null | undefined;
  baselineCalories: number;
  dietType: DietType;
};

export function useCalorieSkew({
  weeklyTargets,
  baselineCalories,
  dietType,
}: UseCalorieSkewProps) {
  const [customDayDistribution, setCustomDayDistribution] = useState(false);
  const [dayCalorieOverrides, setDayCalorieOverrides] = useState<DayCalorieOverrides | null>(null);
  const [skewMacroMode, setSkewMacroMode] = useState<"proportional" | "custom">("proportional");

  const handleToggleCustomDistribution = useCallback(
    (enabled: boolean) => {
      if (enabled && weeklyTargets) {
        const overrides = initializeDayOverridesFromTargets(weeklyTargets);
        setDayCalorieOverrides(overrides);
        setCustomDayDistribution(true);
      } else {
        setCustomDayDistribution(false);
        setDayCalorieOverrides(null);
      }
    },
    [weeklyTargets]
  );

  const handleDayOverrideChange = useCallback(
    (day: DayOfWeek, field: keyof DayCalorieOverrides[DayOfWeek], value: number) => {
      setDayCalorieOverrides((prev) => {
        if (!prev) return prev;
        const dayData = { ...prev[day], [field]: value };

        // In proportional mode, recalculate macros when calories change
        if (field === "calories" && skewMacroMode === "proportional") {
          const isTrainingDay = weeklyTargets?.find((t) => t.day === day)?.isTrainingDay ?? false;
          const proteinG = prev[day].protein_g;
          const macros = calculateDailyMacros(value, proteinG, isTrainingDay, dietType);
          dayData.protein_g = macros.proteinG;
          dayData.carbs_g = macros.carbsG;
          dayData.fat_g = macros.fatG;
        }

        return { ...prev, [day]: dayData };
      });
    },
    [skewMacroMode, weeklyTargets, dietType]
  );

  const handleResetToDefault = useCallback(() => {
    if (weeklyTargets) {
      const overrides = initializeDayOverridesFromTargets(weeklyTargets);
      setDayCalorieOverrides(overrides);
    }
  }, [weeklyTargets]);

  // Budget validation
  const weeklyBaselineTarget = baselineCalories * 7;
  const budgetValidation: WeeklyBudgetValidation | null =
    dayCalorieOverrides
      ? validateWeeklyBudget(dayCalorieOverrides, weeklyBaselineTarget)
      : null;

  /** Reset skew state (called after plan generation) */
  const resetSkew = useCallback(() => {
    setCustomDayDistribution(false);
    setDayCalorieOverrides(null);
  }, []);

  return {
    customDayDistribution,
    dayCalorieOverrides,
    skewMacroMode,
    setSkewMacroMode,
    budgetValidation,
    handleToggleCustomDistribution,
    handleDayOverrideChange,
    handleResetToDefault,
    resetSkew,
  };
}
