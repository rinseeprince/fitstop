"use client";

import { useState, memo } from "react";
import { Button } from "@/components/ui/button";
import { WeeklyScheduleView } from "../schedule/weekly-schedule-view";
import { TrainingSessionCard } from "../sessions/training-session-card";
import { ExternalActivitiesSection } from "../../activities/external-activities-section";
import { PlanDisplayHeader } from "../plan-display-header";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { Dumbbell, CalendarDays, LayoutList, Loader2, AlertTriangle, RefreshCw } from "lucide-react";

type TrainingBuilderRightPanelProps = {
  clientId: string;
};

export const TrainingBuilderRightPanel = memo(function TrainingBuilderRightPanel({
  clientId,
}: TrainingBuilderRightPanelProps) {
  const builder = useTrainingBuilderContext();
  const [editMode, setEditMode] = useState(false);
  const [viewMode, setViewMode] = useState<"week" | "list">("week");

  // Loading state
  if (builder.isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  // Error state
  if (builder.loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-red-50 rounded-lg border-2 border-dashed border-red-200 p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-3" />
        <h3 className="text-lg font-medium text-red-800 mb-1">Failed to load training plan</h3>
        <p className="text-sm text-red-600 mb-4 max-w-sm">{builder.loadError}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => builder.fetchPlan()}
          className="text-red-700 border-red-300 hover:bg-red-100"
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
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-indigo-50 to-sky-50 rounded-lg border-2 border-dashed border-indigo-200">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mb-3" />
        <p className="text-indigo-600 font-medium">Generating your training plan...</p>
        <p className="text-sm text-indigo-500 mt-1">This may take a moment</p>
      </div>
    );
  }

  // Empty state
  if (!builder.plan) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <Dumbbell className="h-8 w-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-medium text-slate-700 mb-2">No training plan yet</h3>
        <p className="text-sm text-slate-500 max-w-sm">
          Use the AI assistant on the left to generate a customized training plan, or create one manually.
        </p>
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
      />

      {/* View Toggle */}
      <div className="flex items-center justify-end gap-1 border-b pb-2 mb-4 mt-2">
        <span className="text-sm text-muted-foreground mr-2">View:</span>
        <Button
          variant={viewMode === "week" ? "default" : "ghost"}
          size="sm"
          onClick={() => setViewMode("week")}
          className="h-8"
        >
          <CalendarDays className="h-4 w-4 mr-1" />
          Week
        </Button>
        <Button
          variant={viewMode === "list" ? "default" : "ghost"}
          size="sm"
          onClick={() => setViewMode("list")}
          className="h-8"
        >
          <LayoutList className="h-4 w-4 mr-1" />
          List
        </Button>
      </div>

      {/* Workout Content */}
      <div className="flex-1 overflow-y-auto">
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
