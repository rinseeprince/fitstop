"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useNutritionPlan } from "@/hooks/use-nutrition-plan";
import type { Client, ActivityLevel, DietType, DayCalorieOverrides } from "@/types/check-in";
import { validateClientForNutrition } from "@/lib/validations/nutrition";
import {
  weightToKg,
  getActivityMultiplier,
  validateWeeklyBudget,
  initializeDayOverridesFromTargets,
  calculateDailyMacros,
  type WeeklyBudgetValidation,
  type DayOfWeek,
} from "@/utils/nutrition-helpers";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import { addDays } from "date-fns";

type UseNutritionBuilderProps = {
  client: Client;
  onUpdate?: () => void;
};

export type NutritionSettings = {
  workActivityLevel: ActivityLevel;
  proteinTargetGPerKg: number;
  dietType: DietType;
  goalDeadline: string;
};

export type CustomMacros = {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
};

export function useNutritionBuilder({ client, onUpdate }: UseNutritionBuilderProps) {
  const { toast } = useToast();
  const nutritionPlan = useNutritionPlan({ client, onUpdate });

  // Settings state — defaults from active plan will be loaded via nutritionData
  const [settings, setSettings] = useState<NutritionSettings>({
    workActivityLevel: "sedentary",
    proteinTargetGPerKg: 2.0,
    dietType: "balanced",
    goalDeadline: "",
  });
  const [settingsChanged, setSettingsChanged] = useState(false);

  // Custom macros state
  const [customMacros, setCustomMacros] = useState<CustomMacros>({
    protein: 0,
    carbs: 0,
    fat: 0,
    calories: 0,
  });
  const [customMacrosValidationError, setCustomMacrosValidationError] = useState<string | null>(
    null
  );
  const [showCustomMacros, setShowCustomMacros] = useState(false);

  // Activity burn toggle
  const [includeActivityBurn, setIncludeActivityBurn] = useState(client.includeActivityBurn);
  const [isSavingBurnToggle, setIsSavingBurnToggle] = useState(false);

  const handleToggleActivityBurn = useCallback(
    async (value: boolean) => {
      setIncludeActivityBurn(value);
      setIsSavingBurnToggle(true);
      try {
        const res = await fetch(`/api/clients/${client.id}/nutrition`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ includeActivityBurn: value }),
        });
        if (!res.ok) throw new Error("Failed to update");
        onUpdate?.();
      } catch {
        toast({
          title: "Error",
          description: "Failed to update activity burn setting",
          variant: "destructive",
        });
        setIncludeActivityBurn(!value);
      } finally {
        setIsSavingBurnToggle(false);
      }
    },
    [client.id, onUpdate, toast]
  );

  // Calorie skewing state
  const [customDayDistribution, setCustomDayDistribution] = useState(false);
  const [dayCalorieOverrides, setDayCalorieOverrides] = useState<DayCalorieOverrides | null>(null);
  const [skewMacroMode, setSkewMacroMode] = useState<"proportional" | "custom">("proportional");
  const [isSavingSkew, setIsSavingSkew] = useState(false);

  // Loading states
  const [isGenerating, setIsGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Validate custom macros
  useEffect(() => {
    if (customMacros.protein > 0 || customMacros.carbs > 0 || customMacros.fat > 0) {
      const calculatedCalories =
        customMacros.protein * 4 + customMacros.carbs * 4 + customMacros.fat * 9;
      const difference = Math.abs(customMacros.calories - calculatedCalories);

      if (customMacros.calories > 0 && difference > CUSTOM_MACRO_CALORIE_TOLERANCE) {
        setCustomMacrosValidationError(
          `Calories should be within ±50 of calculated total (${calculatedCalories} cal from macros)`
        );
      } else {
        setCustomMacrosValidationError(null);
      }
    } else {
      setCustomMacrosValidationError(null);
    }
  }, [customMacros]);

  // Settings change handler
  const handleSettingsChange = useCallback((newSettings: Partial<NutritionSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
    setSettingsChanged(true);
  }, []);

  // Calorie skewing handlers
  const handleToggleCustomDistribution = useCallback(
    async (enabled: boolean) => {
      if (enabled && nutritionPlan.weeklyTargets) {
        const overrides = initializeDayOverridesFromTargets(nutritionPlan.weeklyTargets);
        setDayCalorieOverrides(overrides);
        setCustomDayDistribution(true);
      } else {
        setCustomDayDistribution(false);
        setDayCalorieOverrides(null);
      }
    },
    [nutritionPlan.weeklyTargets]
  );

  const handleDayOverrideChange = useCallback(
    (day: DayOfWeek, field: keyof DayCalorieOverrides[DayOfWeek], value: number) => {
      setDayCalorieOverrides((prev) => {
        if (!prev) return prev;
        const dayData = { ...prev[day], [field]: value };

        // In proportional mode, recalculate macros when calories change
        if (field === "calories" && skewMacroMode === "proportional") {
          const isTrainingDay = nutritionPlan.weeklyTargets?.find((t) => t.day === day)?.isTrainingDay ?? false;
          const proteinG = prev[day].protein_g;
          const macros = calculateDailyMacros(value, proteinG, isTrainingDay, settings.dietType);
          dayData.protein_g = macros.proteinG;
          dayData.carbs_g = macros.carbsG;
          dayData.fat_g = macros.fatG;
        }

        return { ...prev, [day]: dayData };
      });
    },
    [skewMacroMode, nutritionPlan.weeklyTargets, settings.dietType]
  );

  const handleSaveCustomDistribution = useCallback(async () => {
    setIsSavingSkew(true);
    try {
      // Save custom day distribution as a new plan version via the
      // dedicated skewing endpoint. This archives the current active plan
      // and creates a new nutrition_plans row + 7 daily target rows.
      const res = await fetch(`/api/clients/${client.id}/nutrition/skew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayCalorieOverrides,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      onUpdate?.();
      toast({ title: "Custom day distribution saved" });
    } catch {
      toast({
        title: "Error",
        description: "Failed to save custom day distribution",
        variant: "destructive",
      });
    } finally {
      setIsSavingSkew(false);
    }
  }, [client.id, dayCalorieOverrides, onUpdate, toast]);

  const handleResetToDefault = useCallback(() => {
    if (nutritionPlan.weeklyTargets) {
      const overrides = initializeDayOverridesFromTargets(nutritionPlan.weeklyTargets);
      setDayCalorieOverrides(overrides);
    }
  }, [nutritionPlan.weeklyTargets]);

  // Budget validation
  const planBaseline = nutritionPlan.nutritionData?.baselineCalories ?? nutritionPlan.nutritionData?.calorieTarget ?? 0;
  const weeklyBaselineTarget = planBaseline * 7;
  const budgetValidation: WeeklyBudgetValidation | null =
    dayCalorieOverrides
      ? validateWeeklyBudget(dayCalorieOverrides, weeklyBaselineTarget)
      : null;

  // Generate nutrition plan
  const generatePlan = useCallback(
    async (useCustomMacros = false) => {
      const validation = validateClientForNutrition(client);
      if (!validation.valid) {
        toast({
          title: "Missing required data",
          description: validation.errors.join(", "),
          variant: "destructive",
        });
        return false;
      }

      setIsGenerating(true);
      try {
        const body: Record<string, unknown> = {
          workActivityLevel: settings.workActivityLevel,
          proteinTargetGPerKg: settings.proteinTargetGPerKg,
          dietType: settings.dietType,
          goalDeadline: settings.goalDeadline || undefined,
        };

        if (useCustomMacros) {
          body.customMacrosEnabled = true;
          body.customProteinG = customMacros.protein;
          body.customCarbG = customMacros.carbs;
          body.customFatG = customMacros.fat;
          body.customCalories = customMacros.calories;
        }

        const res = await fetch(`/api/clients/${client.id}/nutrition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json();

        if (data.success && data.plan) {
          setWarnings(data.plan.warnings || []);
          toast({
            title: "Nutrition plan generated",
            description: `${data.plan.calorieTarget} cal/day with ${data.plan.proteinTargetG}g protein`,
          });
          setSettingsChanged(false);
          setCustomDayDistribution(false);
          setDayCalorieOverrides(null);
          onUpdate?.();
          nutritionPlan.refetchNutrition();
          return true;
        } else {
          throw new Error(data.error || "Failed to generate plan");
        }
      } catch (error) {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to generate plan",
          variant: "destructive",
        });
        return false;
      } finally {
        setIsGenerating(false);
      }
    },
    [client, settings, customMacros, onUpdate, toast]
  );

  // Calculate projected goal date
  // 7700 calories = approximately 1kg of body weight
  const CALORIES_PER_KG = 7700;

  const getProjectedDate = useCallback(() => {
    const nd = nutritionPlan.nutritionData;
    const baseline = nd?.baselineCalories ?? nd?.calorieTarget;
    if (!client.goalWeight || !client.currentWeight || !baseline) return null;

    const tdee = client.tdee || (client.bmr ? Math.round(client.bmr * getActivityMultiplier(settings.workActivityLevel)) : null);
    if (!tdee) return null;

    const currentWeightKg = weightToKg(client.currentWeight, client.weightUnit || "lbs");
    const goalWeightKg = weightToKg(client.goalWeight, client.weightUnit || "lbs");
    const weightToLoseKg = currentWeightKg - goalWeightKg;

    if (Math.abs(weightToLoseKg) < 0.1) return null;

    const dailyDeficit = tdee - baseline;
    const weeklyWeightChangeKg = (dailyDeficit * 7) / CALORIES_PER_KG;
    if (Math.abs(weeklyWeightChangeKg) < 0.01) return null;

    const weeksNeeded = weightToLoseKg / weeklyWeightChangeKg;
    return addDays(new Date(), Math.round(weeksNeeded * 7));
  }, [client, nutritionPlan.nutritionData, settings.workActivityLevel]);

  return {
    // Spread base nutrition plan state
    ...nutritionPlan,

    // Settings
    settings,
    settingsChanged,
    handleSettingsChange,

    // Custom macros
    customMacros,
    setCustomMacros,
    customMacrosValidationError,
    showCustomMacros,
    setShowCustomMacros,

    // Activity burn toggle
    includeActivityBurn,
    isSavingBurnToggle,
    handleToggleActivityBurn,

    // Calorie skewing
    customDayDistribution,
    dayCalorieOverrides,
    skewMacroMode,
    setSkewMacroMode,
    isSavingSkew,
    budgetValidation,
    handleToggleCustomDistribution,
    handleDayOverrideChange,
    handleSaveCustomDistribution,
    handleResetToDefault,

    // Loading states
    isGenerating,
    warnings,

    // Computed
    projectedDate: getProjectedDate(),

    // Actions
    generatePlan,
  };
}
