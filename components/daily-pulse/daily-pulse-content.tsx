"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Edit } from "lucide-react";
import { TrainingSection } from "./training-section";
import { WellnessSection } from "./wellness-section";
import { NutritionSection } from "./nutrition-section";
import { DailyPulseSummary } from "./daily-pulse-summary";
import type { DailyLog } from "@/types/daily-log";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import type { TrainingSession } from "@/types/training";

// Types moved from types.ts
export type UnplannedActivity = {
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
};

export type TodaysActivity = {
  sessionId: string;
  activityName: string;
  estimatedCalories: number;
};

interface DailyPulseContentProps {
  // Loading & display states
  isLoading: boolean;
  isSaving: boolean;
  isExpanded: boolean;
  hasLoggedToday: boolean;
  showNotes: boolean;
  isSessionOrphaned: boolean;
  // Data
  todayLog: DailyLog | null;
  nutritionTarget: DailyNutritionTargets | null;
  // Training state
  sessionCompleted: boolean;
  currentTrainingSession: TrainingSession | null;
  originalScheduledSessionId: string | null;
  selectedAlternativeSession: string | null;
  activityStatuses: Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>;
  unplannedActivities: UnplannedActivity[];
  allTrainingSessions: TrainingSession[];
  plannedActivities: TodaysActivity[];
  formData: Partial<DailyLog>;
  nutritionData: {
    caloriesConsumed: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  };
  // Handlers
  handleEdit: () => void;
  handleSave: () => void;
  setShowNotes: (show: boolean) => void;
  setFormData: React.Dispatch<React.SetStateAction<Partial<DailyLog>>>;
  setSessionCompleted: (completed: boolean) => void;
  handleAlternativeSessionSelect: (sessionId: string | null) => void;
  handleActivityToggle: (activityId: string, completed: boolean) => void;
  handleAddUnplannedActivity: (activity: UnplannedActivity) => void;
  handleRemoveUnplannedActivity: (index: number) => void;
  setNutritionData: React.Dispatch<React.SetStateAction<{
    caloriesConsumed: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  }>>;
}

export function DailyPulseContent({
  isLoading, isSaving, isExpanded, hasLoggedToday, showNotes, isSessionOrphaned, todayLog, nutritionTarget,
  sessionCompleted, currentTrainingSession, originalScheduledSessionId, selectedAlternativeSession,
  activityStatuses, unplannedActivities, allTrainingSessions, plannedActivities,
  formData, nutritionData, handleEdit, handleSave, setShowNotes, setFormData, setSessionCompleted,
  handleAlternativeSessionSelect, handleActivityToggle, handleAddUnplannedActivity,
  handleRemoveUnplannedActivity, setNutritionData,
}: DailyPulseContentProps) {
  // Determine which nutrition targets to use
  const getSavedNutritionTargets = () => {
    // If log exists and not in edit mode, use saved targets
    if (todayLog?.targetCalories && !isExpanded) {
      return {
        adjustedCalories: todayLog.targetCalories,
        adjustedProteinG: todayLog.targetProteinG || 0,
        adjustedCarbsG: todayLog.targetCarbsG || 0,
        adjustedFatG: todayLog.targetFatG || 0,
      };
    }
    // Otherwise return null to let NutritionSection calculate
    return null;
  };

  const savedTargets = getSavedNutritionTargets();
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-3/4" />
      </div>
    );
  }

  if (hasLoggedToday && !isExpanded) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Today's log complete</span>
          <Button variant="ghost" size="sm" onClick={handleEdit}>
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
        </div>
        
        <DailyPulseSummary todayLog={todayLog!} />

        <Separator />
        
        <TrainingSection
          isExpanded={false}
          hasLoggedToday={hasLoggedToday}
          sessionCompleted={sessionCompleted}
          currentTrainingSession={currentTrainingSession}
          originalScheduledSessionId={originalScheduledSessionId}
          selectedAlternativeSession={selectedAlternativeSession}
          activityStatuses={activityStatuses}
          unplannedActivities={unplannedActivities}
          allTrainingSessions={allTrainingSessions}
          plannedActivities={plannedActivities}
          onSessionCompletedChange={setSessionCompleted}
          onAlternativeSessionSelect={handleAlternativeSessionSelect}
          onActivityToggle={handleActivityToggle}
          onAddUnplannedActivity={handleAddUnplannedActivity}
          onRemoveUnplannedActivity={handleRemoveUnplannedActivity}
          isSessionOrphaned={isSessionOrphaned}
        />

        <Separator />
        
        <NutritionSection
          isExpanded={false}
          hasLoggedToday={hasLoggedToday}
          nutritionTarget={nutritionTarget}
          sessionCompleted={sessionCompleted}
          currentTrainingSession={currentTrainingSession}
          activityStatuses={activityStatuses}
          plannedActivities={plannedActivities}
          unplannedActivities={unplannedActivities}
          caloriesConsumed={nutritionData.caloriesConsumed}
          proteinG={nutritionData.proteinG}
          carbsG={nutritionData.carbsG}
          fatG={nutritionData.fatG}
          onNutritionChange={setNutritionData}
          savedTargets={savedTargets}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WellnessSection
        formData={formData}
        setFormData={setFormData}
        showNotes={showNotes}
        setShowNotes={setShowNotes}
      />

      <Separator />
      
      <TrainingSection
        isExpanded={true}
        hasLoggedToday={hasLoggedToday}
        sessionCompleted={sessionCompleted}
        currentTrainingSession={currentTrainingSession}
        originalScheduledSessionId={originalScheduledSessionId}
        selectedAlternativeSession={selectedAlternativeSession}
        activityStatuses={activityStatuses}
        unplannedActivities={unplannedActivities}
        allTrainingSessions={allTrainingSessions}
        plannedActivities={plannedActivities}
        onSessionCompletedChange={setSessionCompleted}
        onAlternativeSessionSelect={handleAlternativeSessionSelect}
        onActivityToggle={handleActivityToggle}
        onAddUnplannedActivity={handleAddUnplannedActivity}
        onRemoveUnplannedActivity={handleRemoveUnplannedActivity}
        isSessionOrphaned={isSessionOrphaned}
      />

      <Separator />
      
      <NutritionSection
        isExpanded={true}
        hasLoggedToday={hasLoggedToday}
        nutritionTarget={nutritionTarget}
        sessionCompleted={sessionCompleted}
        currentTrainingSession={currentTrainingSession}
        activityStatuses={activityStatuses}
        plannedActivities={plannedActivities}
        unplannedActivities={unplannedActivities}
        caloriesConsumed={nutritionData.caloriesConsumed}
        proteinG={nutritionData.proteinG}
        carbsG={nutritionData.carbsG}
        fatG={nutritionData.fatG}
        onNutritionChange={setNutritionData}
        savedTargets={savedTargets}
      />

      <Button onClick={handleSave} disabled={isSaving} className="w-full">
        {isSaving ? "Saving..." : todayLog ? "Update Log" : "Log Day"}
      </Button>
    </div>
  );
}