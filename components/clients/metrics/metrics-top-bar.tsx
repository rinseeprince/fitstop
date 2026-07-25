"use client";

import useSWR from "swr";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { swrFetcher } from "@/lib/swr-fetcher";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import {
  getGoalWeightDisplay,
  getPhaseGoalProgress,
} from "@/components/clients/training/builder/training-plan-helpers";
import type { Client } from "@/types/check-in";
import type { Phase } from "@/types/roadmap";
import type { MetricTab } from "./metrics-view-types";

export type MetricsTopBarProps = {
  client: Client;
  tab: MetricTab;
  onTabChange: (t: MetricTab) => void;
  onLogClick: () => void;
};

// The Metrics page's tab bar + phase-context row: the Training tab's
// TopContentBar silhouette with the overview context bar's MONO phase cluster.
// Fetches the phase list on the SAME SWR key as use-merged-metrics so the
// request dedups (deliberately /roadmap/phases, not /roadmap).
export function MetricsTopBar({
  client,
  tab,
  onTabChange,
  onLogClick,
}: MetricsTopBarProps) {
  const { data: phasesData } = useSWR<{ success: boolean; data: Phase[] }>(
    `/api/clients/${client.id}/roadmap/phases`,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 1 }
  );
  const activePhase =
    phasesData?.data?.find((p) => p.status === "active") ?? null;

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
  const goalWeightDisplay = activePhase
    ? getGoalWeightDisplay(activePhase, client)
    : null;
  const phaseGoalProgress = activePhase
    ? getPhaseGoalProgress(activePhase, client)
    : null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <SegmentedControl
        options={[
          { value: "body", label: "Physique" },
          { value: "wellness", label: "Wellness" },
        ]}
        value={tab}
        onChange={(value) => onTabChange(value as MetricTab)}
      />

      {activePhase && (
        <>
          {/* Vertical divider */}
          <div className="h-6 w-px bg-[rgba(13,148,136,0.08)]" />

          {/* Phase info (MONO variant — overview-context-bar recipe) */}
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-[13px] font-semibold text-[#0c1a1e] truncate">
              {activePhase.name}
            </span>
            {phaseDateRange && (
              <span className={cn(MONO, "text-[12px] text-[#93b0b4] shrink-0")}>
                {phaseDateRange}
              </span>
            )}
            {goalWeightDisplay && (
              <span className={cn(MONO, "text-[12px] text-[#5a7d82] shrink-0")}>
                {goalWeightDisplay}
              </span>
            )}
            {phaseGoalProgress && (
              <span
                className={cn(
                  MONO,
                  "text-[10.5px] font-semibold text-[#d97706] bg-[rgba(245,158,11,0.07)] px-1.5 py-0.5 rounded-[3px] shrink-0"
                )}
              >
                {phaseGoalProgress}
              </span>
            )}
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-3">
        {activePhase && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-[#0d9488]">
            <span className="h-[5px] w-[5px] rounded-full bg-[#0d9488]" />
            Active
          </span>
        )}
        <button
          type="button"
          onClick={onLogClick}
          className="rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75]"
        >
          Log measurement
        </button>
      </div>
    </div>
  );
}
