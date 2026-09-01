"use client";

import useSWR from "swr";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TextSkeleton } from "@/components/text-skeleton";
import { cn } from "@/lib/utils";
import {
  MONO,
  MONO_LABEL_CLASS,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { SPLIT_TYPE_LABELS } from "@/lib/training-constants";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { TrainingWeekSummary } from "@/types/history";

// The accurate week-scoped training summary hero — Sessions Completed /
// Adherence / Missed from /api/clients/[id]/history/training/summary
// (session_logs vs planned events for the current week). Shared by the Data tab
// (TrainingHistoryTable) and the Plans tab (TrainingBuilderRightPanel). The
// Plans tab previously derived "This Week" from session.dayOfWeek — which
// placement never sets — so it always read a wrong 0-training / 7-rest count;
// this endpoint is the truthful source. Reads `plan` from TrainingBuilderContext
// for the program-info row (both mount sites live inside TrainingBuilderProvider).
export function TrainingSummaryHero({ clientId }: { clientId: string }) {
  const { plan, isLoading: planLoading } = useTrainingBuilderContext();

  const { data: summaryResponse, isLoading: summaryLoading } = useSWR<{
    success: boolean;
    data: TrainingWeekSummary;
  }>(`/api/clients/${clientId}/history/training/summary`, swrFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });
  const summary = summaryResponse?.data;
  const adherencePct =
    summary && summary.plannedUpToToday > 0
      ? Math.round((summary.completed / summary.plannedUpToToday) * 100)
      : 0;

  return (
    <div className="bg-[#0f2027] rounded-[6px] p-5">
      {/* Program info row. While the plan read is in flight the row holds its
          slot as pending — the band must not grow when the plan lands
          (newdesignsystem → "Loading & async states"). If the read settles
          with no plan the row leaves and the band tightens once: the rarer
          case, and a contraction, never a shove. */}
      {planLoading ? (
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-[rgba(255,255,255,0.06)]">
          <span className="text-[12px] font-medium text-[rgba(255,255,255,0.5)]">
            <TextSkeleton className="w-44" />
          </span>
          <div className="flex items-center gap-1.5">
            <span className="bg-[rgba(255,255,255,0.12)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium">
              <TextSkeleton className="w-12" />
            </span>
            <span className="bg-[rgba(255,255,255,0.12)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium">
              <TextSkeleton className="w-10" />
            </span>
          </div>
        </div>
      ) : plan ? (
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-[rgba(255,255,255,0.5)]">
              {plan.name}
            </span>
            {plan.description && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-[rgba(255,255,255,0.3)] cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-sm">{plan.description}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium">
              {SPLIT_TYPE_LABELS[plan.splitType] || plan.splitType}
            </span>
            <span className={cn(MONO, "bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium")}>
              {plan.frequencyPerWeek}x/week
            </span>
            {plan.programDurationWeeks && (
              <span className={cn(MONO, "bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium")}>
                {plan.programDurationWeeks} weeks
              </span>
            )}
          </div>
        </div>
      ) : null}
      {/* Stat columns */}
      <div className="grid grid-cols-[1fr_1fr_1fr]">
        {/* SESSIONS COMPLETED */}
        <div className="flex flex-col pr-5 border-r border-[rgba(255,255,255,0.08)]">
          <p className={STAT_LABEL_DARK_CLASS}>
            Sessions Completed
          </p>
          {/* One tree for both states: the pending value renders INSIDE the
              real elements, so the line boxes — and the band's height — are
              identical by construction. */}
          <p className={cn(STAT_VALUE_DARK_CLASS, "text-[32px] leading-tight mt-1")}>
            {summaryLoading ? <TextSkeleton className="w-20" /> : summary?.completed ?? 0}
          </p>
          <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal text-[11px] text-[rgba(255,255,255,0.35)]")}>
            {summaryLoading ? <TextSkeleton className="w-24" /> : <>of {summary?.totalPlanned ?? 0} planned</>}
          </p>
        </div>

        {/* ADHERENCE */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <p className={STAT_LABEL_DARK_CLASS}>
            Adherence
          </p>
          <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
            {summaryLoading ? (
              <TextSkeleton className="w-14" />
            ) : (
              <>
                {adherencePct}
                <span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">
                  %
                </span>
              </>
            )}
          </p>
          <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal text-[11px] text-[rgba(255,255,255,0.3)] mt-1")}>
            {summaryLoading ? (
              <TextSkeleton className="w-20" />
            ) : (
              <>{summary?.completed ?? 0}/{summary?.plannedUpToToday ?? 0} sessions</>
            )}
          </p>
        </div>

        {/* MISSED THIS WEEK */}
        <div className="flex flex-col pl-5">
          <p className={STAT_LABEL_DARK_CLASS}>
            Missed This Week
          </p>
          <p className={cn(STAT_VALUE_DARK_CLASS, "text-[22px] mt-1")}>
            {summaryLoading ? <TextSkeleton className="w-10" /> : summary?.missed ?? 0}
          </p>
        </div>
      </div>
    </div>
  );
}
