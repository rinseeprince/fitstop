"use client";

import { weightToKg, weightFromKg } from "@/utils/nutrition-helpers";
import type { Client } from "@/types/check-in";
import type { Phase } from "@/types/roadmap";

export function getPhaseGoalProgress(
  activePhase: Phase,
  client: Client
): string | null {
  if (activePhase.phaseGoalWeight != null && client.currentWeight) {
    const unit = client.weightUnit || "lbs";
    const currentKg = weightToKg(client.currentWeight, unit);
    const diffKg = Math.abs(currentKg - activePhase.phaseGoalWeight);
    const displayUnit = unit === "lbs" ? "lbs" : "kg";
    const value =
      unit === "lbs"
        ? weightFromKg(diffKg, "lbs").toFixed(1)
        : diffKg.toFixed(1);
    return `${value} ${displayUnit} to go`;
  }
  return null;
}

export function getGoalWeightDisplay(
  activePhase: Phase,
  client: Client
): string | null {
  if (activePhase.phaseGoalWeight != null && client.currentWeight) {
    const unit = client.weightUnit || "lbs";
    const currentKg = weightToKg(client.currentWeight, unit);
    const displayUnit = unit === "lbs" ? "lbs" : "kg";
    const currentVal =
      unit === "lbs"
        ? weightFromKg(currentKg, "lbs").toFixed(1)
        : currentKg.toFixed(1);
    const goalVal =
      unit === "lbs"
        ? weightFromKg(activePhase.phaseGoalWeight, "lbs").toFixed(1)
        : activePhase.phaseGoalWeight.toFixed(1);
    return `${currentVal} \u2192 ${goalVal} ${displayUnit}`;
  }
  return null;
}
