"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Edit } from "lucide-react";
import { TrainingSection } from "./training-section";
import { WellnessSection } from "./wellness-section";
import { NutritionSection } from "./nutrition-section";
import { WeeklyNutritionProgress } from "./weekly-nutrition-progress";
import { HabitsSection } from "./habits-section";
import { DailyPulseLoggedView } from "./daily-pulse-logged-view";
import { PhaseCompletionCard } from "./phase-completion-card";
import type { DailyLog } from "@/types/daily-log";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import type { TrainingSession } from "@/types/training";
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit";
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";

import type { UnplannedActivity, TodaysActivity } from "@/types/daily-pulse";
export type { UnplannedActivity, TodaysActivity };

type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
};

interface DailyPulseContentProps {
  // Loading & display states
  isLoading: boolean;
  isSaving: boolean;
  isExpanded: boolean;
  hasLoggedToday: boolean;
  isDateDisabled?: boolean;
  showNotes: boolean;
  isSessionOrphaned: boolean;
  selectedDate: string;
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
  habits: DailyHabit[];
  habitLogs: HabitLogWithDetails[];
  weeklyNutritionSummary?: WeeklyNutritionSummary | null;
  onHabitLogsUpdate: (logs: HabitLogWithDetails[]) => void;
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
  isLoading, isSaving, isExpanded, hasLoggedToday, isDateDisabled, showNotes, isSessionOrphaned, selectedDate, todayLog, nutritionTarget,
  sessionCompleted, currentTrainingSession, originalScheduledSessionId, selectedAlternativeSession,
  activityStatuses, unplannedActivities, allTrainingSessions, plannedActivities,
  formData, nutritionData, habits, habitLogs, weeklyNutritionSummary, onHabitLogsUpdate,
  handleEdit, handleSave, setShowNotes, setFormData, setSessionCompleted,
  handleAlternativeSessionSelect, handleActivityToggle, handleAddUnplannedActivity,
  handleRemoveUnplannedActivity, setNutritionData,
}: DailyPulseContentProps) {
  // Determine which nutrition targets to use
  const getSavedNutritionTargets = () => {
    // If log exists and not in edit mode, use saved targets
    if (todayLog?.targetCalories && !isExpanded) {
      return {
        adjustedCalories: todayLog.targetCalories,
        adjustedProteinG: todayLog.targetProteinG ?? 0,
        adjustedCarbsG: todayLog.targetCarbsG ?? 0,
        adjustedFatG: todayLog.targetFatG ?? 0,
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

  if (isDateDisabled) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        Logging starts on your program start date.
      </div>
    );
  }

  if (!hasLoggedToday && !isExpanded) {
    return (
      <div className="space-y-3">
        <PhaseCompletionCard />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Log today's wellness, training & nutrition</span>
          <Button variant="ghost" size="sm" onClick={handleEdit}>
            <Edit className="h-4 w-4 mr-1" />
            Expand
          </Button>
        </div>

        <WeeklyNutritionProgress summary={weeklyNutritionSummary} />

        {habits.length > 0 && (
          <>
            <Separator />
            <HabitsSection
              habits={habits}
              habitLogs={habitLogs}
              onHabitLogsUpdate={onHabitLogsUpdate}
              selectedDate={selectedDate}
            />
          </>
        )}
      </div>
    );
  }

  if (hasLoggedToday && !isExpanded) {
    return (
      <>
        <PhaseCompletionCard />
        <DailyPulseLoggedView
        todayLog={todayLog!}
        nutritionTarget={nutritionTarget}
        sessionCompleted={sessionCompleted}
        currentTrainingSession={currentTrainingSession}
        originalScheduledSessionId={originalScheduledSessionId}
        selectedAlternativeSession={selectedAlternativeSession}
        activityStatuses={activityStatuses}
        unplannedActivities={unplannedActivities}
        allTrainingSessions={allTrainingSessions}
        plannedActivities={plannedActivities}
        nutritionData={nutritionData}
        habits={habits}
        habitLogs={habitLogs}
        selectedDate={selectedDate}
        savedTargets={savedTargets}
        isSessionOrphaned={isSessionOrphaned}
        handleEdit={handleEdit}
        setSessionCompleted={setSessionCompleted}
        handleAlternativeSessionSelect={handleAlternativeSessionSelect}
        handleActivityToggle={handleActivityToggle}
        handleAddUnplannedActivity={handleAddUnplannedActivity}
        handleRemoveUnplannedActivity={handleRemoveUnplannedActivity}
        setNutritionData={setNutritionData}
        onHabitLogsUpdate={onHabitLogsUpdate}
      />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <PhaseCompletionCard />
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

      <WeeklyNutritionProgress summary={weeklyNutritionSummary} />

      <NutritionSection
        isExpanded={true}
        hasLoggedToday={hasLoggedToday}
        nutritionTarget={nutritionTarget}
        sessionCompleted={sessionCompleted}
        currentTrainingSession={currentTrainingSession}
        activityStatuses={activityStatuses}
        plannedActivities={plannedActivities}
        caloriesConsumed={nutritionData.caloriesConsumed}
        proteinG={nutritionData.proteinG}
        carbsG={nutritionData.carbsG}
        fatG={nutritionData.fatG}
        onNutritionChange={setNutritionData}
        savedTargets={savedTargets}
      />

      {habits.length > 0 && (
        <>
          <Separator />
          <HabitsSection
            habits={habits}
            habitLogs={habitLogs}
            onHabitLogsUpdate={onHabitLogsUpdate}
            selectedDate={selectedDate}
          />
        </>
      )}

      <Button onClick={handleSave} disabled={isSaving} className="w-full">
        {isSaving ? "Saving..." : todayLog ? "Update Log" : "Log Day"}
      </Button>
    </div>
  );
}