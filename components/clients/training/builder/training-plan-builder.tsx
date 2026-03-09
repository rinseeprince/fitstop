"use client";

import { useState } from "react";
import { TrainingBuilderProvider } from "@/contexts/training-builder-context";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";
import { TrainingPlanGeneratorDrawer } from "./training-plan-generator-drawer";
import { ErrorBoundary } from "@/components/ui/error-boundary";
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
  const clientWeightKg = client.currentWeight
    ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
    : 70;

  return (
    <ErrorBoundary>
      <TrainingBuilderProvider clientId={client.id} onUpdate={onUpdate}>
        <div className="min-h-[600px]">
          <div className="bg-card rounded-lg border border-border p-5 h-full">
            <ErrorBoundary>
              <TrainingBuilderRightPanel
                clientId={client.id}
                onOpenGenerator={() => setDrawerOpen(true)}
              />
            </ErrorBoundary>
          </div>

          <TrainingPlanGeneratorDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            clientWeightKg={clientWeightKg}
          />
        </div>
      </TrainingBuilderProvider>
    </ErrorBoundary>
  );
}
