"use client";

import { useState, memo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WeeklyScheduleView } from "../schedule/weekly-schedule-view";
import { TrainingSessionCard } from "../sessions/training-session-card";
import { ExternalActivitiesSection } from "../../activities/external-activities-section";
import { PlanDisplayHeader } from "../plan-display-header";
import { TrainingPlanHistoryModal } from "../training-plan-history-modal";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { Dumbbell, CalendarDays, LayoutList, Loader2, AlertTriangle, RefreshCw, Sparkles } from "lucide-react";

type TrainingBuilderRightPanelProps = {
  clientId: string;
  onOpenGenerator?: () => void;
};

export const TrainingBuilderRightPanel = memo(function TrainingBuilderRightPanel({
  clientId,
  onOpenGenerator,
}: TrainingBuilderRightPanelProps) {
  const builder = useTrainingBuilderContext();
  const [editMode, setEditMode] = useState(false);
  const [viewMode, setViewMode] = useState<"week" | "list">("week");
  const [showHistory, setShowHistory] = useState(false);

  // Loading state
  if (builder.isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-muted/50 rounded-lg">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (builder.loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-destructive/5 rounded-lg p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load training plan</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">{builder.loadError}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => builder.fetchPlan()}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Try again
        </Button>
      </div>
    );
  }

  // Generating state
  if (builder.isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-muted/50 rounded-lg">
        <div className="w-12 h-12 rounded-full bg-card shadow-sm flex items-center justify-center mb-4">
          <Sparkles className="h-6 w-6 text-accent animate-pulse" />
        </div>
        <p className="text-foreground font-medium">Generating your training plan...</p>
        <p className="text-sm text-muted-foreground mt-1">This may take a moment</p>
      </div>
    );
  }

  // Empty state - per section 9.3
  if (!builder.plan) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 px-8 text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Dumbbell className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">No training plan yet</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          Generate a customized training plan using AI or create one manually.
        </p>
        {onOpenGenerator && (
          <Button
            onClick={onOpenGenerator}
            className="bg-primary hover:bg-primary/90"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Generate Plan
          </Button>
        )}
      </div>
    );
  }

  // Plan exists - show workout
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PlanDisplayHeader
        plan={builder.plan}
        editMode={editMode}
        onToggleEdit={() => setEditMode(!editMode)}
        onRefreshExercises={builder.refreshExercises}
        isRefreshing={builder.isRefreshingExercises}
        onShowHistory={() => setShowHistory(true)}
        onRegenerate={onOpenGenerator}
      />

      {/* View Toggle - Section 8.5 Segmented Control */}
      <div className="flex items-center justify-between pb-4 mb-4 mt-3">
        <span className="text-sm text-muted-foreground">View</span>
        <div className="bg-muted p-1 rounded-lg inline-flex">
          <button
            onClick={() => setViewMode("week")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all",
              viewMode === "week"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CalendarDays className="h-4 w-4" />
            Week
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all",
              viewMode === "list"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LayoutList className="h-4 w-4" />
            List
          </button>
        </div>
      </div>

      {/* Workout Content */}
      <div className="flex-1 overflow-y-auto px-1">
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

      <TrainingPlanHistoryModal
        clientId={clientId}
        open={showHistory}
        onOpenChange={setShowHistory}
      />
    </div>
  );
});
