"use client";

import { NutritionBuilderProvider } from "@/contexts/nutrition-builder-context";
import { NutritionBuilderLeftPanel } from "./nutrition-builder-left-panel";
import { NutritionBuilderRightPanel } from "./nutrition-builder-right-panel";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import type { Client } from "@/types/check-in";

type NutritionPlanBuilderProps = {
  client: Client;
  onUpdate?: () => void;
};

export function NutritionPlanBuilder({ client, onUpdate }: NutritionPlanBuilderProps) {
  return (
    <ErrorBoundary>
      <NutritionBuilderProvider client={client} onUpdate={onUpdate}>
        <div className="flex flex-col lg:flex-row gap-4 min-h-[600px]">
          {/* Left Panel - 40% width */}
          <div className="w-full lg:w-[40%] lg:min-w-[350px] lg:max-w-[450px] bg-white rounded-lg border p-4">
            <ErrorBoundary>
              <NutritionBuilderLeftPanel />
            </ErrorBoundary>
          </div>

          {/* Right Panel - 60% width */}
          <div className="flex-1 bg-white rounded-lg border p-4">
            <ErrorBoundary>
              <NutritionBuilderRightPanel />
            </ErrorBoundary>
          </div>
        </div>
      </NutritionBuilderProvider>
    </ErrorBoundary>
  );
}
