"use client";

import { useState, useCallback } from "react";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { ApplyDateDialog } from "@/components/ui/apply-date-dialog";
import { RegenerationWarningDialog } from "../calendar/regeneration-warning-dialog";
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
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [pendingEffectiveFrom, setPendingEffectiveFrom] = useState<string | null>(null);
  const [modifiedCount, setModifiedCount] = useState(0);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleClick = useCallback(() => {
    if (editMode) {
      setShowApplyDialog(true);
    } else {
      setEditMode(true);
    }
  }, [editMode, setEditMode]);

  const doRegenerate = useCallback(async (effectiveFrom: string | null, force?: boolean) => {
    if (!builder.plan) return;
    setIsRegenerating(true);
    try {
      await fetch(
        `/api/clients/${clientId}/training/${builder.plan.id}/regenerate-events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            effectiveFrom: effectiveFrom ?? undefined,
            force: force ?? undefined,
          }),
        }
      );
    } catch {
      // Non-critical — events will be regenerated on next plan change
    } finally {
      setIsRegenerating(false);
    }
    setEditMode(false);
    setShowWarningDialog(false);
    setPendingEffectiveFrom(null);
    void builder.fetchPlan();
  }, [clientId, builder, setEditMode]);

  const handleApply = useCallback(async (effectiveFrom: string | null) => {
    if (!builder.plan) return;
    setShowApplyDialog(false);

    // Check for modified events before regenerating
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${builder.plan.id}/events/modified-count`
      );
      if (res.ok) {
        const data = await res.json();
        const count = data.count ?? 0;
        if (count > 0) {
          setPendingEffectiveFrom(effectiveFrom);
          setModifiedCount(count);
          setShowWarningDialog(true);
          return;
        }
      }
    } catch {
      // Non-critical — proceed with regeneration
    }

    await doRegenerate(effectiveFrom);
  }, [clientId, builder, doRegenerate]);

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
      <RegenerationWarningDialog
        open={showWarningDialog}
        onOpenChange={setShowWarningDialog}
        modifiedCount={modifiedCount}
        onConfirm={() => doRegenerate(pendingEffectiveFrom, true)}
        onCancel={() => {
          setShowWarningDialog(false);
          setPendingEffectiveFrom(null);
        }}
        isLoading={isRegenerating}
      />
    </>
  );
}
