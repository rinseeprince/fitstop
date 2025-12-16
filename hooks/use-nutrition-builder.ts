"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useNutritionPlan } from "@/hooks/use-nutrition-plan";
import type { Client, ActivityLevel, DietType } from "@/types/check-in";
import { validateClientForNutrition } from "@/lib/validations/nutrition";
import { weightToKg, getActivityMultiplier } from "@/utils/nutrition-helpers";
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

  // Settings state
  const [settings, setSettings] = useState<NutritionSettings>({
    workActivityLevel: client.workActivityLevel || "sedentary",
    proteinTargetGPerKg: client.proteinTargetGPerKg || 2.0,
    dietType: client.dietType || "balanced",
    goalDeadline: client.goalDeadline || "",
  });
  const [settingsChanged, setSettingsChanged] = useState(false);

  // Custom macros state
  const [customMacros, setCustomMacros] = useState<CustomMacros>({
    protein: client.customProteinG || 0,
    carbs: client.customCarbG || 0,
    fat: client.customFatG || 0,
    calories: client.customCalories || 0,
  });
  const [customMacrosValidationError, setCustomMacrosValidationError] = useState<string | null>(
    null
  );
  const [showCustomMacros, setShowCustomMacros] = useState(false);

  // Loading states
  const [isGenerating, setIsGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Validate custom macros
  useEffect(() => {
    if (customMacros.protein > 0 || customMacros.carbs > 0 || customMacros.fat > 0) {
      const calculatedCalories =
        customMacros.protein * 4 + customMacros.carbs * 4 + customMacros.fat * 9;
      const difference = Math.abs(customMacros.calories - calculatedCalories);

      if (customMacros.calories > 0 && difference > 50) {
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
          onUpdate?.();
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
    const baseline = client.baselineCalories || client.calorieTarget;
    if (!client.goalWeight || !client.currentWeight || !baseline) return null;

    const tdee =
      client.tdee ||
      (client.bmr && client.workActivityLevel
        ? Math.round(client.bmr * getActivityMultiplier(client.workActivityLevel))
        : null);
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
  }, [client]);

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

    // Loading states
    isGenerating,
    warnings,

    // Computed
    projectedDate: getProjectedDate(),

    // Actions
    generatePlan,
  };
}
