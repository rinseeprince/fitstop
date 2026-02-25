"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Edit } from "lucide-react";
import { TrainingSection } from "./training-section";
import { NutritionSection } from "./nutrition-section";
import { HabitsSection } from "./habits-section";
import { DailyPulseSummary } from "./daily-pulse-summary";
import type { DailyLog } from "@/types/daily-log";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import type { TrainingSession } from "@/types/training";
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit";
import type { TodaysActivity, UnplannedActivity } from "./daily-pulse-content";

type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
};

interface DailyPulseLoggedViewProps {
  todayLog: DailyLog;
  nutritionTarget: DailyNutritionTargets | null;
  sessionCompleted: boolean;
  currentTrainingSession: TrainingSession | null;
  originalScheduledSessionId: string | null;
  selectedAlternativeSession: string | null;
  activityStatuses: Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>;
  unplannedActivities: UnplannedActivity[];
  allTrainingSessions: TrainingSession[];
  plannedActivities: TodaysActivity[];
  nutritionData: {
    caloriesConsumed: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  };
  habits: DailyHabit[];
  habitLogs: HabitLogWithDetails[];
  selectedDate: string;
  savedTargets: {
    adjustedCalories: number;
    adjustedProteinG: number;
    adjustedCarbsG: number;
    adjustedFatG: number;
  } | null;
  isSessionOrphaned: boolean;
  handleEdit: () => void;
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
  onHabitLogsUpdate: (logs: HabitLogWithDetails[]) => void;
}

/**
 * Renders the compact view when a day has been logged.
 * Extracted from daily-pulse-content.tsx to reduce component size.
 */
export function DailyPulseLoggedView({
  todayLog, nutritionTarget, sessionCompleted, currentTrainingSession,
  originalScheduledSessionId, selectedAlternativeSession, activityStatuses,
  unplannedActivities, allTrainingSessions, plannedActivities, nutritionData,
  habits, habitLogs, selectedDate, savedTargets, isSessionOrphaned,
  handleEdit, setSessionCompleted, handleAlternativeSessionSelect,
  handleActivityToggle, handleAddUnplannedActivity, handleRemoveUnplannedActivity,
  setNutritionData, onHabitLogsUpdate,
}: DailyPulseLoggedViewProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Today's log complete</span>
        <Button variant="ghost" size="sm" onClick={handleEdit}>
          <Edit className="h-4 w-4 mr-1" />
          Edit
        </Button>
      </div>
      
      <DailyPulseSummary todayLog={todayLog} />

      <Separator />
      
      <TrainingSection
        isExpanded={false}
        hasLoggedToday={true}
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
        hasLoggedToday={true}
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