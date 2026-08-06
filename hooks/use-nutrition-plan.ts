"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Client, UnitPreference, DietType, ActivityLevel } from "@/types/check-in";
import type { GoalDrift } from "@/lib/goals/detect-goal-drift";
import type { NutritionCalcInputs } from "@/services/nutrition-calc-inputs";

type UseNutritionPlanProps = {
  client: Client;
  onUpdate?: () => void;
};

type NutritionTargetsData = {
  calorieTarget?: number;
  proteinTargetG?: number;
  carbTargetG?: number;
  fatTargetG?: number;
  baselineCalories?: number;
  customMacrosEnabled?: boolean;
  customCalories?: number;
  customProteinG?: number;
  customCarbG?: number;
  customFatG?: number;
  dietType?: DietType;
  /** The plan's stored calculator settings, so the builder's pickers seed from
   *  it instead of their hardcoded defaults. Absent when there is no plan. */
  workActivityLevel?: ActivityLevel;
  proteinTargetGPerKg?: number;
  /** Server-resolved inputs for the live preview. Present on BOTH the has-plan
   *  and no-plan responses; null only when the resolver itself failed. */
  calcInputs?: NutritionCalcInputs | null;
  includeActivityBurn: boolean;
  effectiveFrom?: string;
  /** Set only when the plan's window opens AFTER the client's today — i.e. the
   *  plan is queued, not running. Resolved server-side (the browser's local date
   *  can differ from the client's), mirroring GET /training's field of the same
   *  name. */
  scheduledFor?: string | null;
  goalChanged?: GoalDrift;
  /** Does a training plan cover today, or start after it? Mirrors GET /training's
   *  `plan: activePlan ?? nextFullPlan`, so the tab no longer fetches that
   *  210 kB payload just to test it for truthiness. Present on both the
   *  has-plan and no-plan responses. */
  hasTrainingPlan?: boolean;
  /** The name of that same program. Nutrition plans have no name of their own
   *  (`nutrition_plans.name` is never written), so the Plans hero titles itself
   *  with the program the client is on. Null when they are on none. */
  trainingPlanName?: string | null;
};

export function useNutritionPlan({ client, onUpdate }: UseNutritionPlanProps) {
  const { toast } = useToast();

  // Unit preference
  const [unitPreference, setUnitPreferenceState] = useState<UnitPreference>(
    client.unitPreference || "imperial"
  );
  const [isSavingUnit, setIsSavingUnit] = useState(false);

  // Nutrition targets from API (reads from nutrition_plans tables)
  const [nutritionData, setNutritionData] = useState<NutritionTargetsData | null>(null);
  const [isLoadingNutrition, setIsLoadingNutrition] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

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
  const hasPlan = !!nutritionData?.calorieTarget;

  // Regeneration banner: uses base_weight_kg from the active plan
  // This is now handled via the plan data, not client fields
  const showRegenerationBanner = false; // Will be computed from plan data when available


  // The tab used to GET /api/clients/[id]/training — a ~210 kB plan+sessions+
  // exercises payload — and read exactly one thing from it: whether `plan` was
  // truthy. The server now answers that directly. Everything else training-shaped
  // that this surface renders already comes from the nutrition payloads (the
  // TRAIN badge and per-day surplus read nutrition events' isTrainingDay).
  const hasTrainingPlan = nutritionData?.hasTrainingPlan ?? false;
  const trainingPlanName = nutritionData?.trainingPlanName ?? null;

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

  return {
    // Client data
    client,
    hasPlan,

    // Unit preference
    unitPreference,
    isSavingUnit,
    handleUnitChange,

    // Training plan. The existence flag now rides on the nutrition response, so
    // its loading state is the nutrition one — there is no second request to
    // wait on. Name kept for the two consumers that already read it.
    hasTrainingPlan,
    trainingPlanName,
    isLoadingTrainingPlan: isLoadingNutrition,

    // Computed values
    showRegenerationBanner,

    // Nutrition data from plan
    nutritionData,
    isLoadingNutrition,
    refetchNutrition: () => setRefreshKey((k) => k + 1),
  };
}
