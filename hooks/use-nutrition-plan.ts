"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Client, UnitPreference, DietType } from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import type { GoalDrift } from "@/lib/goals/detect-goal-drift";
import {
  getWeightChange as getWeightChangeUtil,
  formatWeight as formatWeightUtil,
  weightToKg,
  kgToLbs,
  getTrainingDays,
} from "@/utils/nutrition-helpers";

type UseNutritionPlanProps = {
  client: Client;
  onUpdate?: () => void;
};

type UpcomingPlanData = {
  effectiveFrom: string;
  calorieTarget: number;
  proteinTargetG: number;
  carbTargetG: number;
  fatTargetG: number;
  dietType: string;
  dailyTargets: DailyNutritionTargets[];
};

type NutritionTargetsData = {
  calorieTarget?: number;
  proteinTargetG?: number;
  carbTargetG?: number;
  fatTargetG?: number;
  baselineCalories?: number;
  customMacrosEnabled?: boolean;
  customCalories?: number;
  dietType?: DietType;
  includeActivityBurn: boolean;
  effectiveFrom?: string;
  upcomingPlan?: UpcomingPlanData | null;
  dailyTargets?: DailyNutritionTargets[];
  goalChanged?: GoalDrift;
};

export function useNutritionPlan({ client, onUpdate }: UseNutritionPlanProps) {
  const { toast } = useToast();

  // Unit preference
  const [unitPreference, setUnitPreferenceState] = useState<UnitPreference>(
    client.unitPreference || "imperial"
  );
  const [isSavingUnit, setIsSavingUnit] = useState(false);

  // Training plan integration
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan | null>(null);
  const [isLoadingTrainingPlan, setIsLoadingTrainingPlan] = useState(true);

  // Nutrition targets from API (reads from nutrition_plans tables)
  const [nutritionData, setNutritionData] = useState<NutritionTargetsData | null>(null);
  const [isLoadingNutrition, setIsLoadingNutrition] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch training plan on mount
  useEffect(() => {
    const fetchTrainingPlan = async () => {
      try {
        const res = await fetch(`/api/clients/${client.id}/training`);
        const data = await res.json();
        if (data.success && data.plan) {
          setTrainingPlan(data.plan);
        }
      } catch (error) {
        console.error("Failed to fetch training plan:", error);
      } finally {
        setIsLoadingTrainingPlan(false);
      }
    };
    fetchTrainingPlan();
  }, [client.id]);

  // Fetch nutrition targets from API (reads from nutrition_plans tables)
  useEffect(() => {
    const fetchNutrition = async () => {
      try {
        const res = await fetch(`/api/clients/${client.id}/nutrition`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setNutritionData(data);
        }
      } catch (error) {
        console.error("Failed to fetch nutrition targets:", error);
      } finally {
        setIsLoadingNutrition(false);
      }
    };
    fetchNutrition();
  }, [client.id, refreshKey]);

  // Computed values
  const baselineCalories = nutritionData?.baselineCalories ?? nutritionData?.calorieTarget;
  const weeklyTargets = nutritionData?.dailyTargets ?? null;
  const hasPlan = !!nutritionData?.calorieTarget;

  // Regeneration banner: uses base_weight_kg from the active plan
  // This is now handled via the plan data, not client fields
  const showRegenerationBanner = false; // Will be computed from plan data when available

  // Legacy flat calorie values (kept for backward compat with display component)
  const dailyTrainingCalories = 0;
  const weeklyTrainingCalories = 0;
  const trainingCaloriesByDay = null;

  const weeklyTotal = weeklyTargets
    ? weeklyTargets.reduce((sum, day) => sum + day.calories, 0)
    : (baselineCalories || 0) * 7;

  const trainingDaysSet = getTrainingDays(trainingPlan);
  const trainingDaysCount = trainingDaysSet.size;
  const restDaysCount = 7 - trainingDaysCount;

  // Unit preference handler
  const handleUnitChange = useCallback(
    async (newUnit: UnitPreference) => {
      setUnitPreferenceState(newUnit);
      setIsSavingUnit(true);
      try {
        const res = await fetch(`/api/clients/${client.id}/nutrition`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unitPreference: newUnit }),
        });

        if (!res.ok) throw new Error("Failed to update unit preference");
        onUpdate?.();
      } catch (_error) {
        toast({
          title: "Error",
          description: "Failed to update unit preference",
          variant: "destructive",
        });
        setUnitPreferenceState(client.unitPreference || "imperial");
      } finally {
        setIsSavingUnit(false);
      }
    },
    [client.id, client.unitPreference, onUpdate, toast]
  );

  // Weight remaining calculation
  const getWeightRemaining = useCallback(() => {
    if (!client.goalWeight || !client.currentWeight) return null;

    const currentWeightKg = weightToKg(client.currentWeight, client.weightUnit || "lbs");
    const goalWeightKg = weightToKg(client.goalWeight, client.weightUnit || "lbs");
    const remainingKg = Math.abs(currentWeightKg - goalWeightKg);
    const isLoss = currentWeightKg > goalWeightKg;

    const value = unitPreference === "imperial" ? kgToLbs(remainingKg) : remainingKg;
    const unit = unitPreference === "imperial" ? "lbs" : "kg";

    return { value: value.toFixed(1), unit, isLoss };
  }, [client, unitPreference]);

  return {
    // Client data
    client,
    hasPlan,

    // Unit preference
    unitPreference,
    isSavingUnit,
    handleUnitChange,

    // Training plan
    trainingPlan,
    isLoadingTrainingPlan,
    dailyTrainingCalories,
    weeklyTrainingCalories,
    trainingCaloriesByDay,

    // Computed values
    showRegenerationBanner,
    weeklyTargets,
    weeklyTotal,
    trainingDaysCount,
    restDaysCount,
    weightRemaining: getWeightRemaining(),

    // Nutrition data from plan
    nutritionData,
    isLoadingNutrition,
    refetchNutrition: () => setRefreshKey((k) => k + 1),

    // Helper functions
    formatWeight: (kg: number) => formatWeightUtil(kg, unitPreference),
    getWeightChange: (current: number, base: number) =>
      getWeightChangeUtil(current, base, unitPreference),
    weightToKg: (weight: number) => weightToKg(weight, client.weightUnit || "lbs"),
  };
}
