"use client";

import { useState, useCallback } from "react";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { ApplyDateDialog } from "@/components/ui/apply-date-dialog";
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
  clientId,
}: {
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  clientId: string;
}) {
  const builder = useTrainingBuilderContext();
  const [showApplyDialog, setShowApplyDialog] = useState(false);

  const handleClick = useCallback(() => {
    if (editMode) {
      // Exiting edit mode — show popup to regenerate events
      setShowApplyDialog(true);
    } else {
      setEditMode(true);
    }
  }, [editMode, setEditMode]);

  const handleApply = useCallback(async (effectiveFrom: string | null) => {
    if (!builder.plan) return;
    try {
      await fetch(
        `/api/clients/${clientId}/training/${builder.plan.id}/regenerate-events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ effectiveFrom: effectiveFrom ?? undefined }),
        }
      );
    } catch {
      // Non-critical — events will be regenerated on next plan change
    }
    setEditMode(false);
    void builder.fetchPlan();
  }, [clientId, builder, setEditMode]);

  return (
    <>
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-[#5a7d82] bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] hover:bg-[#f0f5f4] transition-colors"
      >
        <Settings2 className="h-3.5 w-3.5" />
        {editMode ? "Done" : "Edit"}
      </button>
      <ApplyDateDialog
        open={showApplyDialog}
        onOpenChange={setShowApplyDialog}
        description="Session changes have been saved. Choose when the updated schedule should take effect."
        onApply={handleApply}
      />
    </>
  );
}
