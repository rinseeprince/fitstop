"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame } from "lucide-react";
import { getTodayDateString } from "@/lib/date-helpers";
import { DEBOUNCE_DELAY_MS } from "@/lib/constants";
import { useDailyPulse } from "@/hooks/use-daily-pulse";
import { useTrainingRestoration } from "@/hooks/use-training-restoration";
import { useDailyPulseState } from "@/hooks/use-daily-pulse-state";
import { DailyPulseContent } from "./daily-pulse-content";
import { DayNavBar } from "./day-nav-bar";
import {
  handleAlternativeSessionSelect as handleAltSession,
  handleSessionCompletion,
  extractWellnessData,
  extractNutritionData
} from "./utils/daily-pulse-handlers";
import {
  handleAddUnplannedActivity as createAddHandler,
  handleRemoveUnplannedActivity as createRemoveHandler,
  handleActivityToggle as createToggleHandler,
} from "./utils/daily-pulse-event-handlers";

interface DailyPulseProps {
  startDate?: string;
}

export function DailyPulse({ startDate }: DailyPulseProps = {}) {
  const [selectedDate, setSelectedDate] = useState(getTodayDateString());
  const [debouncedSelectedDate, setDebouncedSelectedDate] = useState(getTodayDateString());
  const today = getTodayDateString();

  // Grey out days before client activation, but only during their first week
  const disableBefore = (() => {
    if (!startDate) return undefined;
    const createdDate = startDate.split("T")[0]; // YYYY-MM-DD
    // Check if createdDate is in the same week as today (Mon-Sun)
    const todayDate = new Date(today + "T00:00:00");
    const todayDay = todayDate.getDay();
    const mondayOffset = todayDay === 0 ? -6 : 1 - todayDay;
    const weekStart = new Date(todayDate);
    weekStart.setDate(todayDate.getDate() + mondayOffset);
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split("T")[0];
    if (createdDate >= weekStartStr && createdDate <= weekEndStr) {
      return createdDate;
    }
    return undefined;
  })();
  
  const { 
    todayLog, 
    streak, 
    nutritionTarget, 
    todaysTrainingSession, 
    plannedActivities, 
    allTrainingSessions,
    habits,
    habitLogs: initialHabitLogs,
    weeklyLogs,
    weeklyNutritionSummary,
    isLoading,
    isSaving, 
    saveLog,
    updateWeeklyLogs
  } = useDailyPulse(debouncedSelectedDate);

  const {
    isExpanded, setIsExpanded, showNotes, setShowNotes,
    isLocalLoading, setIsLocalLoading, formData, setFormData,
    nutritionData, setNutritionData, sessionCompleted, setSessionCompleted,
    currentTrainingSession, setCurrentTrainingSession,
    originalScheduledSessionId, setOriginalScheduledSessionId,
    selectedAlternativeSession, setSelectedAlternativeSession,
    activityStatuses, setActivityStatuses,
    unplannedActivities, setUnplannedActivities,
    wasCompletedPreviously, setWasCompletedPreviously,
    isSessionOrphaned, setIsSessionOrphaned,
    habitLogs, setHabitLogs, resetAllState,
  } = useDailyPulseState(todaysTrainingSession, initialHabitLogs);

  // Handle date change
  const handleDateSelect = (date: string) => {
    if (date === selectedDate) return;
    
    // Show loading skeleton immediately
    setIsLocalLoading(true);
    
    // Update UI immediately
    setSelectedDate(date);
    
    // Clear all state when changing dates
    resetAllState();
  };

  // Debounce the actual data fetch
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSelectedDate(selectedDate);
    }, DEBOUNCE_DELAY_MS);
    
    return () => clearTimeout(timer);
  }, [selectedDate]);

  // Reset local loading when debounce has caught up AND fetch has completed
  useEffect(() => {
    if (!isLoading && debouncedSelectedDate === selectedDate) {
      setIsLocalLoading(false);
    }
  }, [isLoading, debouncedSelectedDate, selectedDate]);

  // Update form data when todayLog loads or changes
  useEffect(() => {
    if (isLoading) return;
    if (todayLog) {
      setFormData(extractWellnessData(todayLog));
      setNutritionData(extractNutritionData(todayLog));
      setIsExpanded(false);
    } else {
      setIsExpanded(false);
    }
  }, [todayLog, isLoading]);
  
  // Update habit logs when initial data changes
  useEffect(() => {
    setHabitLogs(initialHabitLogs);
  }, [initialHabitLogs]);
  // Initialize training data
  useEffect(() => {
    if (!isLoading) {
      setCurrentTrainingSession(todaysTrainingSession);
      setOriginalScheduledSessionId(todaysTrainingSession?.id || null);
      setIsSessionOrphaned(false); // Reset when fresh day loads
    }
  }, [todaysTrainingSession, isLoading]);

  // Restore training data from saved log using custom hook
  useTrainingRestoration({
    isLoading,
    isExpanded,
    todayLog,
    todaysTrainingSession,
    allTrainingSessions,
    setSessionCompleted,
    setCurrentTrainingSession,
    setSelectedAlternativeSession,
    setActivityStatuses,
    setUnplannedActivities,
    setWasCompletedPreviously,
    setIsSessionOrphaned,
  });

  const handleSave = async () => {
    const trainingSessionId = sessionCompleted && currentTrainingSession ? currentTrainingSession.id : undefined;
    const trainingData = {
      sessionCompleted,
      trainingSessionId: currentTrainingSession?.id || null,
      trainingSessionName: currentTrainingSession?.name || null,
      isAlternativeSession: selectedAlternativeSession !== null,
      activityStatuses,
      unplannedActivities
    };

    await saveLog({
      ...formData,
      trained: sessionCompleted,
      trainingSessionId,
      trainingData,
      caloriesConsumed: nutritionData.caloriesConsumed ?? undefined,
      proteinG: nutritionData.proteinG ?? undefined,
      carbsG: nutritionData.carbsG ?? undefined,
      fatG: nutritionData.fatG ?? undefined,
    });
    await handleSessionCompletion(sessionCompleted, trainingSessionId, todayLog?.trainingSessionId, wasCompletedPreviously, setWasCompletedPreviously);

    // Optimistically update weekly logs if a new log was created
    if (!todayLog && debouncedSelectedDate) {
      updateWeeklyLogs(debouncedSelectedDate);
    }
    
    setIsExpanded(false);
    setShowNotes(false);
  };

  const handleEdit = () => {
    setFormData(extractWellnessData(todayLog));
    setNutritionData(extractNutritionData(todayLog));
    setIsExpanded(true);
  };

  const handleAlternativeSessionSelect = (sessionId: string | null) => {
    handleAltSession(
      sessionId,
      allTrainingSessions,
      originalScheduledSessionId,
      setCurrentTrainingSession,
      setSelectedAlternativeSession,
      setSessionCompleted
    );
  };

  const handleAddUnplannedActivity = createAddHandler(unplannedActivities, setUnplannedActivities);
  const handleRemoveUnplannedActivity = createRemoveHandler(unplannedActivities, setUnplannedActivities);
  const handleActivityToggle = createToggleHandler(plannedActivities, activityStatuses, setActivityStatuses);

  const hasLoggedToday = !!todayLog && (todayLog.mood !== null || todayLog.energy !== null ||
    todayLog.sleep !== null || todayLog.stress !== null || todayLog.trained !== null);

  const isDateDisabled = selectedDate > today || (!!disableBefore && selectedDate < disableBefore);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Daily Pulse</CardTitle>
          {streak > 0 && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Flame className="h-3 w-3" />
              {streak} day streak
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <DayNavBar
          selectedDate={selectedDate}
          onSelectDate={handleDateSelect}
          dailyLogs={weeklyLogs}
          today={today}
          disableBefore={disableBefore}
        />
        
        <DailyPulseContent
          isLoading={isLoading || isLocalLoading}
          isSaving={isSaving}
          isExpanded={isExpanded}
          hasLoggedToday={hasLoggedToday}
          isDateDisabled={isDateDisabled}
          showNotes={showNotes}
          todayLog={todayLog}
          nutritionTarget={nutritionTarget}
          sessionCompleted={sessionCompleted}
          currentTrainingSession={currentTrainingSession}
          originalScheduledSessionId={originalScheduledSessionId}
          selectedAlternativeSession={selectedAlternativeSession}
          activityStatuses={activityStatuses}
          unplannedActivities={unplannedActivities}
          allTrainingSessions={allTrainingSessions}
          plannedActivities={plannedActivities}
          formData={formData}
          nutritionData={nutritionData}
          habits={habits}
          habitLogs={habitLogs}
          weeklyNutritionSummary={weeklyNutritionSummary}
          onHabitLogsUpdate={setHabitLogs}
          handleEdit={handleEdit}
          handleSave={handleSave}
          setShowNotes={setShowNotes}
          setFormData={setFormData}
          setSessionCompleted={setSessionCompleted}
          handleAlternativeSessionSelect={handleAlternativeSessionSelect}
          handleActivityToggle={handleActivityToggle}
          handleAddUnplannedActivity={handleAddUnplannedActivity}
          handleRemoveUnplannedActivity={handleRemoveUnplannedActivity}
          setNutritionData={setNutritionData}
          isSessionOrphaned={isSessionOrphaned}
          selectedDate={selectedDate}
        />
      </CardContent>
    </Card>
  );
}