"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Client, UnitPreference } from "@/types/check-in";
import type { TrainingPlan } from "@/types/training";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import {
  shouldShowRegenerationBanner,
  getWeightChange as getWeightChangeUtil,
  formatWeight as formatWeightUtil,
  weightToKg,
  kgToLbs,
  getWeeklyNutritionTargets,
  getTrainingDays,
} from "@/utils/nutrition-helpers";
import {
  calculateDailyTrainingCalories,
  calculateWeeklyTrainingCalories,
  getTrainingCaloriesByDay,
} from "@/utils/training-calorie-helpers";

type UseNutritionPlanProps = {
  client: Client;
  onUpdate?: () => void;
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

  // Computed values
  const showRegenerationBanner =
    client.currentWeight &&
    client.nutritionPlanBaseWeightKg &&
    shouldShowRegenerationBanner(
      weightToKg(client.currentWeight, client.weightUnit || "lbs"),
      client.nutritionPlanBaseWeightKg
    );

  const dailyTrainingCalories = trainingPlan ? calculateDailyTrainingCalories(trainingPlan) : 0;
  const weeklyTrainingCalories = trainingPlan ? calculateWeeklyTrainingCalories(trainingPlan) : 0;
  const trainingCaloriesByDay = trainingPlan ? getTrainingCaloriesByDay(trainingPlan) : null;

  const baselineCalories = client.baselineCalories || client.calorieTarget;
  const weeklyTargets: DailyNutritionTargets[] | null =
    baselineCalories && client.proteinTargetG
      ? getWeeklyNutritionTargets(
          baselineCalories,
          client.proteinTargetG,
          trainingPlan,
          client.dietType || "balanced"
        )
      : null;

  const weeklyTotal = weeklyTargets
    ? weeklyTargets.reduce((sum, day) => sum + day.calories, 0)
    : (client.calorieTarget || 0) * 7;

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
      } catch (error) {
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
    hasPlan: !!client.calorieTarget,

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

    // Helper functions
    formatWeight: (kg: number) => formatWeightUtil(kg, unitPreference),
    getWeightChange: (current: number, base: number) =>
      getWeightChangeUtil(current, base, unitPreference),
    weightToKg: (weight: number) => weightToKg(weight, client.weightUnit || "lbs"),
  };
}
