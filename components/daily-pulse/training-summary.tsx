"use client";

import { Badge } from "@/components/ui/badge";
import { Flame, Check } from "lucide-react";
import type { TrainingSession } from "@/types/training";

type UnplannedActivity = {
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
};

type TodaysActivity = {
  sessionId: string;
  activityName: string;
  estimatedCalories: number;
};

interface TrainingSummaryProps {
  sessionCompleted: boolean;
  currentTrainingSession: TrainingSession | null;
  activityStatuses: Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>;
  plannedActivities: TodaysActivity[];
  totalCalories: number;
}

export function TrainingSummary({
  sessionCompleted,
  currentTrainingSession,
  activityStatuses,
  plannedActivities,
  totalCalories,
}: TrainingSummaryProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Training & activities</span>
        {totalCalories > 0 && (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Flame className="h-3 w-3" />
            {totalCalories} cal
          </Badge>
        )}
      </div>
      {sessionCompleted && currentTrainingSession && (
        <div className="text-sm flex items-center gap-2">
          {currentTrainingSession.name}
          <Check className="h-4 w-4 text-green-600" />
        </div>
      )}
      {plannedActivities
        .filter(activity => activityStatuses[activity.sessionId]?.completed)
        .map(activity => (
          <div key={activity.sessionId} className="text-sm flex items-center gap-2">
            {activity.activityName}
            <Check className="h-4 w-4 text-green-600" />
          </div>
        ))}
    </div>
  );
}