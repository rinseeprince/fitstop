"use client";

import { Settings2 } from "lucide-react";
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

export function EditModeButton({
  editMode,
  setEditMode,
}: {
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  clientId: string;
}) {
  return (
    <button
      onClick={() => setEditMode(!editMode)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-[#5a7d82] bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] hover:bg-[#f0f5f4] transition-colors"
    >
      <Settings2 className="h-3.5 w-3.5" />
      {editMode ? "Done" : "Edit"}
    </button>
  );
}
