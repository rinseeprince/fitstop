"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  TrainingBuilderProvider,
  useTrainingBuilderContext,
} from "@/contexts/training-builder-context";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";
import { TrainingPlanBuilderOverlay } from "./training-plan-builder-overlay";
import { TrainingHistoryTable } from "../training-history-table";
import { ExerciseDataView } from "../exercise-data/exercise-data-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { getPhaseGoalProgress, getGoalWeightDisplay } from "./training-plan-helpers";
import { format } from "date-fns";
import type { Client } from "@/types/check-in";

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

  const rawSubtab = searchParams.get("subtab");
  const subtab: "data" | "plans" | "exercise-data" =
    rawSubtab === "plans" ? "plans"
    : rawSubtab === "exercise-data" ? "exercise-data"
    : "data";
  const setSubtab = (tab: "data" | "plans" | "exercise-data") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("subtab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <ErrorBoundary>
      <TrainingBuilderProvider clientId={client.id} onUpdate={onUpdate}>
        <TopContentBar subtab={subtab} setSubtab={setSubtab} client={client} />

        {subtab === "data" ? (
          <div className="space-y-4">
            <TrainingHistoryTable clientId={client.id} />
          </div>
        ) : subtab === "exercise-data" ? (
          <div className="space-y-4">
            <ExerciseDataView clientId={client.id} />
          </div>
        ) : (
          <div className="space-y-4">
            <ErrorBoundary>
              <TrainingBuilderRightPanel
                clientId={client.id}
                clientName={client.name}
                onOpenGenerator={() => setDrawerOpen(true)}
              />
            </ErrorBoundary>
          </div>
        )}

        <TrainingPlanBuilderOverlay
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          clientName={client.name}
        />
      </TrainingBuilderProvider>
    </ErrorBoundary>
  );
}

// Slim subtab bar: the shared segmented control + phase context. The Plans
// surface owns its own actions now — Apply program lives on the hero,
// View/Edit + Delete-future in the calendar toolbar.
function TopContentBar({
  subtab,
  setSubtab,
  client,
}: {
  subtab: "data" | "plans" | "exercise-data";
  setSubtab: (tab: "data" | "plans" | "exercise-data") => void;
  client: Client;
}) {
  const builder = useTrainingBuilderContext();
  const { plan, activePhase } = builder;

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
        .join(" – ")
    : null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <SegmentedControl
        options={[
          { value: "data", label: "Data" },
          { value: "plans", label: "Plans" },
          { value: "exercise-data", label: "Exercise Data" },
        ]}
        value={subtab}
        onChange={(value) => setSubtab(value as "data" | "plans" | "exercise-data")}
      />

      {plan && activePhase && (
        <>
          {/* Vertical divider */}
          <div className="h-6 w-px bg-[rgba(13,148,136,0.08)]" />

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
              <span className="rounded-[3px] bg-[rgba(245,158,11,0.07)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#d97706]">
                {phaseGoalProgress}
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-[#0d9488]">
              <span className="h-[5px] w-[5px] rounded-full bg-[#0d9488]" />
              Active
            </span>
          </div>
        </>
      )}
    </div>
  );
}
