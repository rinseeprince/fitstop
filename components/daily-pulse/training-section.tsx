"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CheckCircle2 } from "lucide-react";
import { SessionPicker } from "./session-picker";
import { ActivityList } from "./activity-list";
import { TrainingSummary } from "./training-summary";
import type { TrainingSession } from "@/types/training";
import type { UnplannedActivity, TodaysActivity } from "./daily-pulse-content";

interface TrainingSectionProps {
  isExpanded: boolean;
  hasLoggedToday: boolean;
  sessionCompleted: boolean;
  currentTrainingSession: TrainingSession | null;
  originalScheduledSessionId: string | null;
  selectedAlternativeSession: string | null;
  activityStatuses: Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>;
  unplannedActivities: UnplannedActivity[];
  allTrainingSessions: TrainingSession[];
  plannedActivities: TodaysActivity[];
  isSessionOrphaned?: boolean;
  onSessionCompletedChange: (completed: boolean) => void;
  onAlternativeSessionSelect: (sessionId: string | null) => void;
  onActivityToggle: (activityId: string, completed: boolean) => void;
  onAddUnplannedActivity: (activity: UnplannedActivity) => void;
  onRemoveUnplannedActivity: (index: number) => void;
}

export function TrainingSection({
  isExpanded,
  hasLoggedToday,
  sessionCompleted,
  currentTrainingSession,
  originalScheduledSessionId,
  selectedAlternativeSession,
  activityStatuses,
  unplannedActivities,
  allTrainingSessions,
  plannedActivities,
  isSessionOrphaned = false,
  onSessionCompletedChange,
  onAlternativeSessionSelect,
  onActivityToggle,
  onAddUnplannedActivity,
  onRemoveUnplannedActivity,
}: TrainingSectionProps) {
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);

  // Calculate total calories from all completed activities
  const calculateTotalCalories = () => {
    let total = 0;
    
    if (sessionCompleted && currentTrainingSession) {
      total += currentTrainingSession.estimatedCalories || 0;
    }
    
    plannedActivities.forEach(activity => {
      if (activityStatuses[activity.sessionId]?.completed) {
        total += activity.estimatedCalories;
      }
    });
    
    unplannedActivities.forEach(activity => {
      // Simplified MET calculation
      const metValues = { low: 3.5, moderate: 6.0, vigorous: 8.5 };
      const calories = Math.round(
        (metValues[activity.intensityLevel] * 70 * activity.durationMinutes) / 60
      );
      total += calories;
    });
    
    return total;
  };

  const totalCalories = calculateTotalCalories();

  if (!isExpanded) {
    return (
      <TrainingSummary
        sessionCompleted={sessionCompleted}
        currentTrainingSession={currentTrainingSession}
        activityStatuses={activityStatuses}
        plannedActivities={plannedActivities}
        totalCalories={totalCalories}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Label className="text-base">Training</Label>

      <SessionPicker
        currentTrainingSession={currentTrainingSession}
        originalScheduledSessionId={originalScheduledSessionId}
        selectedAlternativeSession={selectedAlternativeSession}
        allTrainingSessions={allTrainingSessions}
        showSessionPicker={showSessionPicker}
        setShowSessionPicker={setShowSessionPicker}
        onAlternativeSessionSelect={onAlternativeSessionSelect}
        isOrphaned={isSessionOrphaned}
      />

      {/* Session Completion Toggle */}
      {currentTrainingSession && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Session completed</span>
          </div>
          <Switch
            checked={sessionCompleted}
            onCheckedChange={onSessionCompletedChange}
            disabled={!hasLoggedToday && !isExpanded}
          />
        </div>
      )}

      <ActivityList
        plannedActivities={plannedActivities}
        unplannedActivities={unplannedActivities}
        activityStatuses={activityStatuses}
        showAddActivity={showAddActivity}
        setShowAddActivity={setShowAddActivity}
        onActivityToggle={onActivityToggle}
        onAddUnplannedActivity={onAddUnplannedActivity}
        onRemoveUnplannedActivity={onRemoveUnplannedActivity}
      />
    </div>
  );
}