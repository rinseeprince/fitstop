"use client";

import { useState } from "react";
import { NutritionBuilderProvider } from "@/contexts/nutrition-builder-context";
import { NutritionBuilderRightPanel } from "./nutrition-builder-right-panel";
import { NutritionSettingsDrawer } from "./nutrition-settings-drawer";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import type { Client } from "@/types/check-in";

type NutritionPlanBuilderProps = {
  client: Client;
  onUpdate?: () => void;
};

export function NutritionPlanBuilder({ client, onUpdate }: NutritionPlanBuilderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <ErrorBoundary>
      <NutritionBuilderProvider client={client} onUpdate={onUpdate}>
        <div className="min-h-[600px]">
          <div className="bg-white rounded-xl shadow-sm p-5 h-full">
            <ErrorBoundary>
              <NutritionBuilderRightPanel
                onOpenSettings={() => setDrawerOpen(true)}
              />
            </ErrorBoundary>
          </div>

          <NutritionSettingsDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
          />
        </div>
      </NutritionBuilderProvider>
    </ErrorBoundary>
  );
}
