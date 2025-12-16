"use client";

import { TrainingBuilderProvider } from "@/contexts/training-builder-context";
import { TrainingBuilderLeftPanel } from "./training-builder-left-panel";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";
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
  const clientWeightKg = client.currentWeight
    ? weightToKg(client.currentWeight, client.weightUnit || "lbs")
    : 70;

  return (
    <ErrorBoundary>
      <TrainingBuilderProvider clientId={client.id} onUpdate={onUpdate}>
        <div className="flex flex-col lg:flex-row gap-4 min-h-[600px]">
          {/* Left Panel - 40% width */}
          <div className="w-full lg:w-[40%] lg:min-w-[350px] lg:max-w-[450px] bg-white rounded-lg border p-4">
            <ErrorBoundary>
              <TrainingBuilderLeftPanel clientWeightKg={clientWeightKg} />
            </ErrorBoundary>
          </div>

          {/* Right Panel - 60% width */}
          <div className="flex-1 bg-white rounded-lg border p-4">
            <ErrorBoundary>
              <TrainingBuilderRightPanel clientId={client.id} />
            </ErrorBoundary>
          </div>
        </div>
      </TrainingBuilderProvider>
    </ErrorBoundary>
  );
}
