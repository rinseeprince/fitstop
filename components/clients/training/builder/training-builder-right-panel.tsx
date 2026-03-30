"use client";

import { useState, useMemo, memo } from "react";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { swrFetcher } from "@/lib/swr-fetcher";
import { WeeklyScheduleView } from "../schedule/weekly-schedule-view";
import { TrainingSessionCard } from "../sessions/training-session-card";
import { ExternalActivitiesSection } from "../../activities/external-activities-section";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dumbbell,
  CalendarDays,
  LayoutList,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Info,
} from "lucide-react";
import { SPLIT_TYPE_LABELS } from "@/lib/training-constants";
import type { TrainingHistoryRow } from "@/types/history";

type TrainingBuilderRightPanelProps = {
  clientId: string;
  onOpenGenerator?: () => void;
};

type HistoryResponse = {
  rows: TrainingHistoryRow[];
  total: number;
};

export const TrainingBuilderRightPanel = memo(function TrainingBuilderRightPanel({
  clientId,
  onOpenGenerator,
}: TrainingBuilderRightPanelProps) {
  const builder = useTrainingBuilderContext();
  const { editMode } = builder;
  const [viewMode, setViewMode] = useState<"week" | "list">("week");

  // Fetch training history for completion stats
  const { data: historyData } = useSWR<HistoryResponse>(
    `/api/clients/${clientId}/history/training?limit=50&offset=0`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  // Compute plan-focused summary stats
  const summaryStats = useMemo(() => {
    const sessions = builder.trainingSessions;
    const sessionCount = sessions.length;

    // Count training vs rest days
    const assignedDays = new Set(
      sessions.filter((s) => s.dayOfWeek).map((s) => s.dayOfWeek)
    );
    const trainingDays = assignedDays.size;
    const restDays = 7 - trainingDays;

    // Total volume (minutes)
    const totalMinutes = sessions.reduce(
      (sum, s) => sum + (s.estimatedDurationMinutes || 0),
      0
    );
    const avgMinutes =
      sessionCount > 0 ? Math.round(totalMinutes / sessionCount) : 0;

    // Total exercises
    const totalExercises = sessions.reduce(
      (sum, s) => sum + (s.exercises?.length || 0),
      0
    );
    const avgExercises =
      sessionCount > 0 ? Math.round(totalExercises / sessionCount) : 0;

    // Completion from history
    const rows = historyData?.rows ?? [];
    const completedCount = rows.filter(
      (r) => r.completion_quality === "full"
    ).length;
    const totalLogged = rows.length;
    const completionPct =
      totalLogged > 0 ? Math.round((completedCount / totalLogged) * 100) : null;

    return {
      sessionCount,
      trainingDays,
      restDays,
      totalMinutes,
      avgMinutes,
      totalExercises,
      avgExercises,
      completionPct,
      completedCount,
      totalLogged,
    };
  }, [builder.trainingSessions, historyData]);

  // Loading state
  if (builder.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#93b0b4]" />
      </div>
    );
  }

  // Error state
  if (builder.loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-[rgba(192,96,96,0.08)] flex items-center justify-center mb-4">
          <AlertTriangle className="h-6 w-6 text-[#c06060]" />
        </div>
        <h3 className="text-base font-semibold text-[#0c1a1e] mb-2">
          Failed to load training plan
        </h3>
        <p className="text-sm text-[#93b0b4] mb-6 max-w-sm">
          {builder.loadError}
        </p>
        <button
          onClick={() => builder.fetchPlan()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-[#5a7d82] bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] hover:bg-[#f0f5f4] transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  }

  // Generating state
  if (builder.isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-12 h-12 rounded-full bg-[#e6f5f3] flex items-center justify-center mb-4">
          <Sparkles className="h-6 w-6 text-[#0d9488] animate-pulse" />
        </div>
        <p className="text-[#0c1a1e] font-medium">
          Generating your training plan...
        </p>
        <p className="text-sm text-[#93b0b4] mt-1">This may take a moment</p>
      </div>
    );
  }

  // Empty state
  if (!builder.plan) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 bg-[#f0f5f4] rounded-full flex items-center justify-center mb-4">
          <Dumbbell className="h-8 w-8 text-[#93b0b4]" />
        </div>
        <h3 className="text-base font-semibold text-[#0c1a1e] mb-2">
          No training plan yet
        </h3>
        <p className="text-sm text-[#93b0b4] mb-6 max-w-sm">
          Generate a customized training plan using AI or create one manually.
        </p>
        {onOpenGenerator && (
          <button
            onClick={onOpenGenerator}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white bg-[#0d9488] rounded-[6px] hover:bg-[#0f766e] transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Generate Plan
          </button>
        )}
      </div>
    );
  }

  // Plan exists - show workout
  return (
    <div className="flex flex-col gap-4">
      {/* Dark summary strip */}
      <div className="bg-[#0f2027] rounded-[6px] p-5">
        {/* Program info row */}
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-[rgba(255,255,255,0.5)]">
              {builder.plan.name}
            </span>
            {builder.plan.description && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-[rgba(255,255,255,0.3)] cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-sm">{builder.plan.description}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium">
              {SPLIT_TYPE_LABELS[builder.plan.splitType] || builder.plan.splitType}
            </span>
            <span className="bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium">
              {builder.plan.frequencyPerWeek}x/week
            </span>
            {builder.plan.programDurationWeeks && (
              <span className="bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium">
                {builder.plan.programDurationWeeks} weeks
              </span>
            )}
          </div>
        </div>
        {/* Stat columns */}
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr]">
        {/* THIS WEEK */}
        <div className="flex flex-col pr-5 border-r border-[rgba(255,255,255,0.08)]">
          <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">
            This Week
          </p>
          <p className="text-[32px] font-bold leading-tight mt-1 text-white">
            {summaryStats.sessionCount}
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.35)]">sessions</p>
          <p className="text-[11px] text-[rgba(255,255,255,0.35)] font-mono-display mt-auto pt-2">
            {summaryStats.trainingDays}T {summaryStats.restDays}R
          </p>
        </div>

        {/* TOTAL VOLUME */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">
            Total Volume
          </p>
          <p className="text-[22px] font-bold text-white mt-1">
            {summaryStats.totalMinutes}
            <span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">
              min
            </span>
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono-display mt-1">
            {summaryStats.avgMinutes}min avg
          </p>
        </div>

        {/* EXERCISES */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.06)]">
          <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">
            Exercises
          </p>
          <p className="text-[22px] font-bold text-white mt-1">
            {summaryStats.totalExercises}
            <span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">
              total
            </span>
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono-display mt-1">
            {summaryStats.avgExercises}/session avg
          </p>
        </div>

        {/* COMPLETION */}
        <div className="flex flex-col pl-5">
          <p className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">
            Completion
          </p>
          <p className="text-[22px] font-bold text-white mt-1">
            {summaryStats.completionPct != null ? summaryStats.completionPct : "—"}
            {summaryStats.completionPct != null && (
              <span className="text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5">
                %
              </span>
            )}
          </p>
          <p className="text-[11px] text-[rgba(255,255,255,0.3)] font-mono-display mt-1">
            {summaryStats.totalLogged > 0
              ? `${summaryStats.completedCount}/${summaryStats.totalLogged} logged`
              : "No data yet"}
          </p>
        </div>
        </div>
      </div>

      {/* Section header: WEEKLY SCHEDULE */}
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[10.5px] uppercase tracking-[0.07em] text-[#93b0b4] font-semibold whitespace-nowrap">
          Weekly Schedule
        </span>
        <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
        {/* Week/List segmented control */}
        <div className="bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] inline-flex">
          <button
            onClick={() => setViewMode("week")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-all",
              viewMode === "week"
                ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                : "text-[#5a7d82] hover:text-[#0c1a1e]"
            )}
          >
            <CalendarDays className="h-3 w-3" />
            Week
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-all",
              viewMode === "list"
                ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                : "text-[#5a7d82] hover:text-[#0c1a1e]"
            )}
          >
            <LayoutList className="h-3 w-3" />
            List
          </button>
        </div>
      </div>

      {/* Workout content */}
      <div className="px-0">
        {viewMode === "week" ? (
          <WeeklyScheduleView
            sessions={builder.trainingSessions}
            activities={builder.externalActivities}
            editMode={editMode}
            clientId={clientId}
            planId={builder.plan.id}
            onUpdate={builder.fetchPlan}
          />
        ) : (
          <>
            <div className="space-y-2">
              {builder.trainingSessions.map((session) => (
                <TrainingSessionCard
                  key={session.id}
                  session={session}
                  clientId={clientId}
                  planId={builder.plan!.id}
                  editMode={editMode}
                  onUpdate={builder.fetchPlan}
                />
              ))}
            </div>
            <ExternalActivitiesSection
              activities={builder.externalActivities}
              clientId={clientId}
              planId={builder.plan.id}
              editMode={editMode}
              onUpdate={builder.fetchPlan}
            />
          </>
        )}
      </div>
    </div>
  );
});
