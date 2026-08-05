"use client";

import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useNutritionPlan } from "@/hooks/use-nutrition-plan";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import type { Client, ActivityLevel, DietType } from "@/types/check-in";
import { validateClientForNutrition } from "@/lib/validations/nutrition";
import {
  weightToKg,
  getActivityMultiplier,
} from "@/utils/nutrition-helpers";
import { addDays } from "date-fns";
import { useCustomMacros } from "@/hooks/use-custom-macros";

type UseNutritionBuilderProps = {
  client: Client;
  onUpdate?: () => void;
};

export type NutritionSettings = {
  workActivityLevel: ActivityLevel;
  proteinTargetGPerKg: number;
  dietType: DietType;
};

export function useNutritionBuilder({ client, onUpdate }: UseNutritionBuilderProps) {
  const { toast } = useToast();
  const nutritionPlan = useNutritionPlan({ client, onUpdate });
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();

  // Settings state — defaults from active plan will be loaded via nutritionData
  const [settings, setSettings] = useState<NutritionSettings>({
    workActivityLevel: "sedentary",
    proteinTargetGPerKg: 2.0,
    dietType: "balanced",
  });
  const [settingsChanged, setSettingsChanged] = useState(false);

  // Custom macros: %-split input stored as grams (◆3). Generation mode drives
  // whether the footer generate posts custom macros (Custom tab) or not (Auto).
  const customMacroState = useCustomMacros(nutritionPlan.nutritionData);
  const customMacros = customMacroState.customMacros; // grams + re-totaled calories
  const [generationMode, setGenerationMode] = useState<"auto" | "custom">("auto");

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

  // Surplus distribution toggle (mig 117): false = keep the plan's carb:fat ratio
  // on a training-day surplus; true = add the whole surplus as carbs.
  const [surplusAsCarbs, setSurplusAsCarbs] = useState(client.surplusAsCarbs);
  const [isSavingSurplusToggle, setIsSavingSurplusToggle] = useState(false);

  const handleToggleSurplusAsCarbs = useCallback(
    async (value: boolean) => {
      setSurplusAsCarbs(value);
      setIsSavingSurplusToggle(true);
      try {
        const res = await fetch(`/api/clients/${client.id}/nutrition`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ surplusAsCarbs: value }),
        });
        if (!res.ok) throw new Error("Failed to update");
        onUpdate?.();
      } catch {
        toast({
          title: "Error",
          description: "Failed to update surplus setting",
          variant: "destructive",
        });
        setSurplusAsCarbs(!value);
      } finally {
        setIsSavingSurplusToggle(false);
      }
    },
    [client.id, onUpdate, toast]
  );

  const [coachNotes, setCoachNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Settings change handler
  const handleSettingsChange = useCallback((newSettings: Partial<NutritionSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
    setSettingsChanged(true);
  }, []);

  // Generate nutrition plan
  const generatePlan = useCallback(
    async (useCustom = false, effectiveFrom?: string | null, preserveCalories?: boolean) => {
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
          // goalDeadline is no longer sent: the deadline is owned by
          // client_goals, resolved server-side. The builder's dead deadline
          // input was replaced by a read-only Goal line.
          ...(coachNotes.trim() ? { coachNotes: coachNotes.trim() } : {}),
          ...(effectiveFrom ? { effectiveFrom } : {}),
          ...(preserveCalories ? { preserveCalories: true } : {}),
        };

        if (useCustom) {
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
          setCoachNotes("");
          onUpdate?.();
          nutritionPlan.refetchNutrition();
          // The calendar renders from its own SWR events cache — revalidate it
          // or the regenerated days only appear after a page refresh.
          void invalidateNutritionCalendar(client.id);
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
    [
      client,
      settings,
      customMacros.protein,
      customMacros.carbs,
      customMacros.fat,
      customMacros.calories,
      coachNotes,
      onUpdate,
      toast,
      nutritionPlan,
      invalidateNutritionCalendar,
    ]
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

    // Custom macros (%-split state) + generation mode (Auto | Custom tabs)
    ...customMacroState,
    generationMode,
    setGenerationMode,

    // Activity burn toggle
    includeActivityBurn,
    isSavingBurnToggle,
    handleToggleActivityBurn,

    // Surplus distribution toggle
    surplusAsCarbs,
    isSavingSurplusToggle,
    handleToggleSurplusAsCarbs,

    // Coach notes on the generated plan
    coachNotes,
    setCoachNotes,

    // Loading states
    isGenerating,
    warnings,

    // Computed
    projectedDate: getProjectedDate(),

    // Actions
    generatePlan,
  };
}
