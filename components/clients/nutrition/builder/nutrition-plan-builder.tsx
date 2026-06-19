"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { NutritionBuilderProvider, useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { NutritionBuilderRightPanel } from "./nutrition-builder-right-panel";
import { NutritionSettingsDrawer } from "./nutrition-settings-drawer";
import { NutritionHistoryTable } from "../nutrition-history-table";
import { NutritionCalendarView } from "../calendar/nutrition-calendar-view";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { weightFromKg } from "@/utils/nutrition-helpers";
import { format } from "date-fns";
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
        {/* Top content bar */}
        <TopContentBar
          subtab={subtab}
          setSubtab={setSubtab}
          onOpenSettings={() => setDrawerOpen(true)}
        />

        {subtab === "data" ? (
          <div className="space-y-4">
            <NutritionHistoryTable clientId={client.id} />
          </div>
        ) : (
          <div className="space-y-4">
            <NoPlanAlert />
            <ErrorBoundary>
              <NutritionBuilderRightPanel
                onOpenSettings={() => setDrawerOpen(true)}
              />
            </ErrorBoundary>
            <ErrorBoundary>
              <NutritionCalendarMount />
            </ErrorBoundary>
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

function TopContentBar({
  subtab,
  setSubtab,
  onOpenSettings,
}: {
  subtab: "data" | "plans";
  setSubtab: (tab: "data" | "plans") => void;
  onOpenSettings: () => void;
}) {
  const builder = useNutritionBuilderContext();
  const { activePhase } = builder;

  const showPhaseInfo = activePhase && builder.hasPlan;

  const phaseGoalProgress = showPhaseInfo ? getPhaseGoalProgress(builder) : null;
  const goalWeightDisplay = showPhaseInfo ? getGoalWeightDisplay(builder) : null;

  const phaseDateRange = activePhase
    ? [
        activePhase.startDate ? format(new Date(activePhase.startDate), "MMM d") : null,
        activePhase.endDate ? format(new Date(activePhase.endDate), "MMM d") : null,
      ]
        .filter(Boolean)
        .join(" \u2013 ")
    : null;

  return (
    <div className="flex items-center gap-4 mb-5">
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

      {builder.hasPlan && (
        <>
          {/* Phase info — only when the client has a live phase. The Regenerate
              action below renders whenever a plan exists, roadmap/phase or not. */}
          {activePhase && (
            <>
              {/* Vertical divider */}
              <div className="w-px h-6 bg-[rgba(13,148,136,0.08)]" />

              {/* Phase info */}
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-[#0c1a1e]">{activePhase.name}</span>
                {phaseDateRange && (
                  <span className="text-[12px] text-[#93b0b4]">{phaseDateRange}</span>
                )}
                {goalWeightDisplay && (
                  <span className="text-[12px] text-[#5a7d82]">{goalWeightDisplay}</span>
                )}
                {phaseGoalProgress && (
                  <span className="text-[10.5px] font-semibold text-[#d97706] bg-[rgba(245,158,11,0.07)] px-1.5 py-0.5 rounded-[3px]">
                    {phaseGoalProgress}
                  </span>
                )}
              </div>
            </>
          )}

          {/* Right side */}
          <div className="ml-auto flex items-center gap-3">
            {activePhase && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-[#0d9488]">
                <span className="w-[5px] h-[5px] rounded-full bg-[#0d9488]" />
                Active
              </span>
            )}
            <button
              onClick={onOpenSettings}
              className="inline-flex items-center px-3 py-1.5 text-[12.5px] font-medium text-[#5a7d82] bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] hover:bg-[#f0f5f4] transition-colors"
            >
              Regenerate
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function NoPlanAlert() {
  const builder = useNutritionBuilderContext();

  if (!builder.activePhase || builder.hasPlan || builder.isLoadingNutrition) return null;

  return (
    <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-[6px]">
      <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-foreground">
        No nutrition plan for this phase — generate one with the Regenerate Plan button.
      </p>
    </div>
  );
}

/**
 * Mounts the nutrition calendar (the primary day-by-day surface) by pulling
 * clientId/timezone/phases/burn-toggle from the builder context — the same
 * context-consumer pattern as TopContentBar/NoPlanAlert. Only renders once a
 * plan exists (no plan => no events => an empty grid the right-panel CTA covers).
 */
function NutritionCalendarMount() {
  const builder = useNutritionBuilderContext();
  if (!builder.hasPlan) return null;

  return (
    <div className="bg-white rounded-[6px] p-4 border border-[rgba(13,148,136,0.06)]">
      <NutritionCalendarView
        clientId={builder.client.id}
        phases={builder.phases}
        clientTimezone={builder.client.timezone}
        includeActivityBurn={builder.includeActivityBurn}
        onUpdate={() => builder.refetchNutrition()}
      />
    </div>
  );
}

function getPhaseGoalProgress(builder: ReturnType<typeof useNutritionBuilderContext>): string | null {
  const { activePhase, client, unitPreference } = builder;

  if (activePhase?.phaseGoalWeight != null && client.currentWeight) {
    const currentKg = builder.weightToKg(client.currentWeight);
    const diffKg = Math.abs(currentKg - activePhase.phaseGoalWeight);
    const unit = unitPreference === "imperial" ? "lbs" : "kg";
    const value = unitPreference === "imperial"
      ? weightFromKg(diffKg, "lbs").toFixed(1)
      : diffKg.toFixed(1);
    return `${value} ${unit} to go`;
  }

  if (builder.weightRemaining) {
    const wr = builder.weightRemaining;
    return `${wr.isLoss ? "-" : "+"}${wr.value} ${wr.unit} to go`;
  }

  return null;
}

function getGoalWeightDisplay(builder: ReturnType<typeof useNutritionBuilderContext>): string | null {
  const { activePhase, client, unitPreference } = builder;

  if (activePhase?.phaseGoalWeight != null && client.currentWeight) {
    const currentKg = builder.weightToKg(client.currentWeight);
    const unit = unitPreference === "imperial" ? "lbs" : "kg";
    const currentVal = unitPreference === "imperial"
      ? weightFromKg(currentKg, "lbs").toFixed(1)
      : currentKg.toFixed(1);
    const goalVal = unitPreference === "imperial"
      ? weightFromKg(activePhase.phaseGoalWeight, "lbs").toFixed(1)
      : activePhase.phaseGoalWeight.toFixed(1);
    return `${currentVal} \u2192 ${goalVal} ${unit}`;
  }

  return null;
}
