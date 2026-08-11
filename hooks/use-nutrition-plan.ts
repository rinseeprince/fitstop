"use client";

import { useState, useEffect } from "react";
import type { Client, DietType, ActivityLevel } from "@/types/check-in";
import type { GoalDrift } from "@/lib/goals/detect-goal-drift";
import type { NutritionCalcInputs } from "@/services/nutrition-calc-inputs";

// No `onUpdate`: its only consumer here was the deleted unit-change handler.
// The callback is still live one level up in useNutritionBuilder (plan
// generate/save/delete all fire it) — it just no longer reaches this hook.
type UseNutritionPlanProps = {
  client: Client;
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
  /** A plan exists — a version covers today OR one is queued. The server's
   *  explicit verdict (migration 144); never derive it from a target field. */
  hasPlan?: boolean;
  /** The COVERING version's start — "Active since". Null for a queued-only
   *  chain, where nothing governs today yet. */
  effectiveFrom?: string | null;
  /** The EARLIEST queued version's start. Resolved server-side (the browser's
   *  local date can differ from the client's), mirroring GET /training's field
   *  of the same name. */
  scheduledFor?: string | null;
  /** A version COVERS the client's today — they are on live targets right now
   *  (migration 144: the plan rows answer this; the old per-event probe is
   *  retired). With `scheduledFor` set, this separates "New targets from X"
   *  (the covering version keeps running until then) from "Starts X" (a first
   *  plan, nothing in the interim). */
  hasCurrentTargets?: boolean;
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

export function useNutritionPlan({ client }: UseNutritionPlanProps) {
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

  // The server's explicit verdict (migration 144). The old `!!calorieTarget`
  // derivation broke on legitimate states — a queued-only chain has a plan and
  // a calorie target of its own era, and a zero-target sentinel would read as
  // "no plan" — so the GET now says it outright on both branches.
  const hasPlan = nutritionData?.hasPlan ?? false;

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

  // No unit-preference handler here any more. It PATCHed the CLIENT's
  // unit_preference whenever the coach flipped the drawer's toggle — a
  // cross-user write from one person's screen onto another person's account,
  // and the last surviving piece of the model where a unit lived on the client
  // RECORD rather than on the viewer. The coach now reads their own preference
  // from useUnits(), so the client's unit was irrelevant to what the coach saw
  // even before the write was wrong.
  //
  // Deleted rather than repointed at the coach's preference: a units control
  // buried in one client's nutrition drawer that silently changes units across
  // the whole app is worse than no control. Settings owns this now.

  return {
    // Client data
    client,
    hasPlan,

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
