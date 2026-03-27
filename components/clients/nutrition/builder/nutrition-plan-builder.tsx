"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { NutritionBuilderProvider, useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionBuilderRightPanel } from "./nutrition-builder-right-panel";
import { NutritionSettingsDrawer } from "./nutrition-settings-drawer";
import { NutritionHistoryTable } from "../nutrition-history-table";
import { NutritionPlanHistory } from "../nutrition-plan-history";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { weightFromKg } from "@/utils/nutrition-helpers";
import type { Client } from "@/types/check-in";

type NutritionPlanBuilderProps = {
  client: Client;
  onUpdate?: () => void;
};

export function NutritionPlanBuilder({ client, onUpdate }: NutritionPlanBuilderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  const subtab = searchParams.get("subtab") === "plans" ? "plans" : "data";
  const setSubtab = (tab: "data" | "plans") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("subtab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <ErrorBoundary>
      <NutritionBuilderProvider client={client} onUpdate={onUpdate}>
        {/* Sub-tab switcher */}
        <div className="bg-muted p-1 rounded-lg inline-flex mb-4">
          {(["data", "plans"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSubtab(tab)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-all",
                subtab === tab
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "data" ? "Data" : "Plans"}
            </button>
          ))}
        </div>

        {subtab === "data" ? (
          <div className="space-y-6">
            <PhaseProgressLine />
            <NutritionHistoryTable clientId={client.id} />
          </div>
        ) : (
          <div className="space-y-6">
            <NoPlanAlert />
            <div className="bg-card rounded-lg border border-border p-5">
              <ErrorBoundary>
                <NutritionBuilderRightPanel
                  onOpenSettings={() => setDrawerOpen(true)}
                />
              </ErrorBoundary>
            </div>
            <NutritionPlanHistory clientId={client.id} />
          </div>
        )}

        <NutritionSettingsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
        />
      </NutritionBuilderProvider>
    </ErrorBoundary>
  );
}

function PhaseProgressLine() {
  const builder = useNutritionBuilderContext();
  const { activePhase, weightRemaining, unitPreference } = builder;

  if (activePhase?.phaseGoalWeight != null && builder.client.currentWeight) {
    const currentKg = builder.weightToKg(builder.client.currentWeight);
    const diffKg = Math.abs(currentKg - activePhase.phaseGoalWeight);
    const unit = unitPreference === "imperial" ? "lbs" : "kg";
    const value = unitPreference === "imperial"
      ? weightFromKg(diffKg, "lbs").toFixed(1)
      : diffKg.toFixed(1);

    return (
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{activePhase.name}</span>
        {" — "}
        {value} {unit} to phase goal
      </p>
    );
  }

  if (weightRemaining) {
    return (
      <p className="text-sm text-muted-foreground">
        {weightRemaining.isLoss ? "-" : "+"}
        {weightRemaining.value} {weightRemaining.unit} to goal
      </p>
    );
  }

  return null;
}

function NoPlanAlert() {
  const builder = useNutritionBuilderContext();

  if (!builder.activePhase || builder.hasPlan) return null;

  return (
    <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
      <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-foreground">
        No nutrition plan for this phase — generate one with the Regenerate Plan button.
      </p>
    </div>
  );
}
