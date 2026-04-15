"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  TrainingBuilderProvider,
  useTrainingBuilderContext,
} from "@/contexts/training-builder-context";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";
import { TrainingPlanGeneratorDrawer } from "./training-plan-generator-drawer";
import { PlanPreviewDrawer } from "../library/plan-preview-drawer";
import { TrainingHistoryTable } from "../training-history-table";
import { TrainingPlanHistory } from "../training-plan-history";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { EditModeButton, getPhaseGoalProgress, getGoalWeightDisplay } from "./training-plan-helpers";
import { Sparkles, Shuffle, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import type { Client } from "@/types/check-in";
import { weightToKg } from "@/utils/nutrition-helpers";

type TrainingPlanBuilderProps = {
  client: Client;
  onUpdate?: () => void;
};

export function TrainingPlanBuilder({
  client,
  onUpdate,
}: TrainingPlanBuilderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  const subtab = searchParams.get("subtab") === "plans" ? "plans" : "data";
  const setSubtab = (tab: "data" | "plans") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("subtab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const clientWeightKg = client.currentWeight
    ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
    : 70;

  return (
    <ErrorBoundary>
      <TrainingBuilderProvider clientId={client.id} onUpdate={onUpdate}>
        <TopContentBar
          subtab={subtab}
          setSubtab={setSubtab}
          onOpenGenerator={() => setDrawerOpen(true)}
          client={client}
        />

        {subtab === "data" ? (
          <div className="space-y-4">
            <TrainingHistoryTable clientId={client.id} />
          </div>
        ) : (
          <div className="space-y-4">
            <ErrorBoundary>
              <TrainingBuilderRightPanel
                clientId={client.id}
                onOpenGenerator={() => setDrawerOpen(true)}
              />
            </ErrorBoundary>
            <TrainingPlanHistory clientId={client.id} />
          </div>
        )}

        <TrainingPlanGeneratorDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          clientWeightKg={clientWeightKg}
          weightUnit={client.weightUnit || "lbs"}
        />

        <PreviewDrawerBridge />
      </TrainingBuilderProvider>
    </ErrorBoundary>
  );
}

function TopContentBar({
  subtab,
  setSubtab,
  onOpenGenerator,
  client,
}: {
  subtab: "data" | "plans";
  setSubtab: (tab: "data" | "plans") => void;
  onOpenGenerator: () => void;
  client: Client;
}) {
  const builder = useTrainingBuilderContext();
  const { plan, editMode, setEditMode, activePhase } = builder;
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);

  const handleGenerateClick = () => {
    if (plan) {
      setShowGenerateConfirm(true);
    } else {
      onOpenGenerator();
    }
  };

  const showPhaseInfo = activePhase && plan;

  const phaseGoalProgress = showPhaseInfo
    ? getPhaseGoalProgress(activePhase, client)
    : null;
  const goalWeightDisplay = showPhaseInfo
    ? getGoalWeightDisplay(activePhase, client)
    : null;

  const phaseDateRange = activePhase
    ? [
        activePhase.startDate
          ? format(new Date(activePhase.startDate), "MMM d")
          : null,
        activePhase.endDate
          ? format(new Date(activePhase.endDate), "MMM d")
          : null,
      ]
        .filter(Boolean)
        .join(" \u2013 ")
    : null;

  return (
    <div className="flex items-center gap-4 mb-5 flex-wrap">
      {/* Segmented control */}
      <div className="bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] inline-flex">
        {(["data", "plans"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubtab(tab)}
            className={cn(
              "px-4 py-1.5 text-[12.5px] font-medium rounded-[4px] transition-all",
              subtab === tab
                ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                : "text-[#5a7d82] hover:text-[#0c1a1e]"
            )}
          >
            {tab === "data" ? "Data" : "Plans"}
          </button>
        ))}
      </div>

      {showPhaseInfo && (
        <>
          {/* Vertical divider */}
          <div className="w-px h-6 bg-[rgba(13,148,136,0.08)]" />

          {/* Phase info */}
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold text-[#0c1a1e]">
              {activePhase.name}
            </span>
            {phaseDateRange && (
              <span className="text-[12px] text-[#93b0b4]">
                {phaseDateRange}
              </span>
            )}
            {goalWeightDisplay && (
              <span className="text-[12px] text-[#5a7d82]">
                {goalWeightDisplay}
              </span>
            )}
            {phaseGoalProgress && (
              <span className="text-[10.5px] font-semibold text-[#d97706] bg-[rgba(245,158,11,0.07)] px-1.5 py-0.5 rounded-[3px]">
                {phaseGoalProgress}
              </span>
            )}
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-3">
            {/* Active indicator (always shown) */}
            <span className="flex items-center gap-1.5 text-xs font-medium text-[#0d9488]">
              <span className="w-[5px] h-[5px] rounded-full bg-[#0d9488]" />
              Active
            </span>

            {/* Action buttons - Plans subtab only */}
            {subtab === "plans" && (
              <>
                <EditModeButton editMode={editMode} setEditMode={setEditMode} clientId={client.id} />
                <button
                  onClick={handleGenerateClick}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-[#5a7d82] bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] hover:bg-[#f0f5f4] transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Regenerate
                </button>
                <button
                  onClick={() => builder.refreshExercises()}
                  disabled={builder.isRefreshingExercises}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-[#5a7d82] bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] hover:bg-[#f0f5f4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {builder.isRefreshingExercises ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Shuffle className="h-3.5 w-3.5" />
                  )}
                  {builder.isRefreshingExercises
                    ? "Refreshing..."
                    : "New Exercises"}
                </button>
              </>
            )}
          </div>
        </>
      )}

      <Dialog open={showGenerateConfirm} onOpenChange={setShowGenerateConfirm}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[rgba(192,96,96,0.08)] flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-[#c06060]" />
              </div>
              <DialogTitle>Generate a new plan?</DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              Generating a new plan will archive your current plan and delete all future scheduled sessions. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowGenerateConfirm(false);
                onOpenGenerator();
              }}
            >
              Generate New Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Bridges builder context to the preview drawer (must be inside TrainingBuilderProvider). */
function PreviewDrawerBridge() {
  const builder = useTrainingBuilderContext();
  if (!builder.savedPlanId) return null;

  return (
    <PlanPreviewDrawer
      savedPlanId={builder.savedPlanId}
      open={!!builder.savedPlanId}
      onOpenChange={(open) => {
        if (!open) builder.setSavedPlanId(null);
      }}
      onDiscard={() => builder.setSavedPlanId(null)}
    />
  );
}
