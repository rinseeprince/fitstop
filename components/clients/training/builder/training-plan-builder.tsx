"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { TrainingBuilderProvider } from "@/contexts/training-builder-context";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";
import { TrainingPlanBuilderOverlay } from "./training-plan-builder-overlay";
import { TrainingHistoryTable } from "../training-history-table";
import { ExerciseDataView } from "../exercise-data/exercise-data-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
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

  // Honor `subtab` only when the URL's `tab` is actually ours: on a tab switch
  // the visible tab flips (local state on the client page) before
  // router.replace lands, so a stale `subtab=plans` written by the NUTRITION
  // tab would otherwise flash the training calendar here before Data renders.
  const rawSubtab =
    searchParams.get("tab") === "training" ? searchParams.get("subtab") : null;
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
        <TopContentBar subtab={subtab} setSubtab={setSubtab} />

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

// Slim subtab bar: the shared segmented control. The Plans surface owns its
// own actions now — Apply program lives on the hero, View/Edit +
// Delete-future in the calendar toolbar.
function TopContentBar({
  subtab,
  setSubtab,
}: {
  subtab: "data" | "plans" | "exercise-data";
  setSubtab: (tab: "data" | "plans" | "exercise-data") => void;
}) {
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
    </div>
  );
}
