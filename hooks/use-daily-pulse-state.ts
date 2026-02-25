"use client";

import { useState } from "react";
import type { DailyLog } from "@/types/daily-log";
import type { TrainingSession } from "@/types/training";
import type { UnplannedActivity } from "@/components/daily-pulse/daily-pulse-content";
import type { DailyHabitLog } from "@/types/daily-habit";

type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
};

/**
 * Hook to manage all state for the daily pulse component.
 * Extracted from daily-pulse.tsx to reduce component size.
 */
export function useDailyPulseState(
  todaysTrainingSession: TrainingSession | null,
  initialHabitLogs: HabitLogWithDetails[]
) {
  // Display states
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  
  // Wellness state
  const [formData, setFormData] = useState<Partial<DailyLog>>({
    mood: undefined, energy: undefined, sleep: undefined, stress: undefined, notes: undefined,
  });
  
  // Nutrition state
  const [nutritionData, setNutritionData] = useState({
    caloriesConsumed: null as number | null, 
    proteinG: null as number | null,
    carbsG: null as number | null, 
    fatG: null as number | null,
  });
  
  // Training state
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [currentTrainingSession, setCurrentTrainingSession] = useState(todaysTrainingSession);
  const [originalScheduledSessionId, setOriginalScheduledSessionId] = useState<string | null>(null);
  const [selectedAlternativeSession, setSelectedAlternativeSession] = useState<string | null>(null);
  const [activityStatuses, setActivityStatuses] = useState<Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>>({});
  const [unplannedActivities, setUnplannedActivities] = useState<UnplannedActivity[]>([]);
  const [wasCompletedPreviously, setWasCompletedPreviously] = useState(false);
  const [isSessionOrphaned, setIsSessionOrphaned] = useState(false);
  
  // Habits state - managed locally for optimistic updates
  const [habitLogs, setHabitLogs] = useState<HabitLogWithDetails[]>(initialHabitLogs);

  // Reset all state (used when changing dates)
  const resetAllState = () => {
    setIsExpanded(false);
    setShowNotes(false);
    setFormData({
      mood: undefined, energy: undefined, sleep: undefined, stress: undefined, notes: undefined,
    });
    setNutritionData({
      caloriesConsumed: null, proteinG: null, carbsG: null, fatG: null,
    });
    setSessionCompleted(false);
    setCurrentTrainingSession(todaysTrainingSession);
    setSelectedAlternativeSession(null);
    setActivityStatuses({});
    setUnplannedActivities([]);
    setWasCompletedPreviously(false);
    setIsSessionOrphaned(false);
  };

  return {
    // Display states
    isExpanded,
    setIsExpanded,
    showNotes,
    setShowNotes,
    isLocalLoading,
    setIsLocalLoading,
    // Data states
    formData,
    setFormData,
    nutritionData,
    setNutritionData,
    sessionCompleted,
    setSessionCompleted,
    currentTrainingSession,
    setCurrentTrainingSession,
    originalScheduledSessionId,
    setOriginalScheduledSessionId,
    selectedAlternativeSession,
    setSelectedAlternativeSession,
    activityStatuses,
    setActivityStatuses,
    unplannedActivities,
    setUnplannedActivities,
    wasCompletedPreviously,
    setWasCompletedPreviously,
    isSessionOrphaned,
    setIsSessionOrphaned,
    habitLogs,
    setHabitLogs,
    // Utility
    resetAllState,
  };
}