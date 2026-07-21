"use client";

import { memo } from "react";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { Loader2, AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { TrainingCalendarView } from "../calendar/training-calendar-view";
import { TrainingSummaryHero } from "@/components/clients/training/training-summary-hero";

type TrainingBuilderRightPanelProps = {
  clientId: string;
  onOpenGenerator?: () => void;
};

export const TrainingBuilderRightPanel = memo(function TrainingBuilderRightPanel({
  clientId,
  onOpenGenerator,
}: TrainingBuilderRightPanelProps) {
  const builder = useTrainingBuilderContext();
  const { editMode } = builder;

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

  // Calendar is always visible — plan-specific UI renders only when plan exists.
  // Coexisting plans render plainly via the calendar; deletion lives on the
  // plan-builder header ("Delete future sessions") and the calendar week menu.
  return (
    <div className="flex flex-col gap-4">
      {/* Accurate week summary (Sessions Completed / Adherence / Missed) — the
          same hero the Data tab shows. Replaces the old dayOfWeek-derived strip,
          which always read a wrong 0-training / 7-rest count because placement
          never sets day_of_week. */}
      {builder.plan && <TrainingSummaryHero clientId={clientId} />}

      {/* Empty-state hero — shown when no plan exists */}
      {!builder.plan && (
        <div className="bg-[#0f2027] rounded-[6px] p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[rgba(13,148,136,0.15)] flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-5 w-5 text-[#0d9488]" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-white">
                No training plan yet
              </p>
              <p className="text-[11.5px] text-[rgba(255,255,255,0.5)] mt-0.5">
                Apply a program from your library to this client&apos;s calendar.
              </p>
            </div>
          </div>
          {onOpenGenerator && (
            <button
              onClick={onOpenGenerator}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-white bg-[#0d9488] rounded-[6px] hover:bg-[#0f766e] transition-colors flex-shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Browse programs
            </button>
          )}
        </div>
      )}

      {/* Calendar — always visible */}
      <div className="px-0">
        <TrainingCalendarView
          clientId={clientId}
          plan={builder.plan ?? null}
          phases={builder.phases}
          editMode={editMode}
          clientTimezone={builder.clientTimezone}
          onUpdate={builder.fetchPlan}
        />
      </div>
    </div>
  );
});
