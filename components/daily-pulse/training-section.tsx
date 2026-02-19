"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dumbbell, Activity, Plus, X, Flame } from "lucide-react";
import { AddActivityForm } from "./add-activity-form";
import { TrainingSummary } from "./training-summary";
import type { TrainingSession } from "@/types/training";

type TodaysActivity = {
  sessionId: string;
  activityName: string;
  estimatedCalories: number;
};

type UnplannedActivity = {
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
};

interface TrainingSectionProps {
  isExpanded: boolean;
  hasLoggedToday: boolean;
  sessionCompleted: boolean;
  currentTrainingSession: TrainingSession | null;
  originalScheduledSessionId: string | null;
  selectedAlternativeSession: string | null;
  activityStatuses: Record<string, boolean>;
  unplannedActivities: UnplannedActivity[];
  allTrainingSessions: TrainingSession[];
  plannedActivities: TodaysActivity[];
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
  onSessionCompletedChange,
  onAlternativeSessionSelect,
  onActivityToggle,
  onAddUnplannedActivity,
  onRemoveUnplannedActivity,
}: TrainingSectionProps) {
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);

  const totalCalories = 
    (sessionCompleted && currentTrainingSession ? currentTrainingSession.estimatedCalories || 0 : 0) +
    plannedActivities.reduce((sum, activity) => 
      sum + (activityStatuses[activity.sessionId] ? activity.estimatedCalories : 0), 0
    );

  const handleAddActivity = (activity: UnplannedActivity) => {
    onAddUnplannedActivity(activity);
    setShowAddActivity(false);
  };

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
      {/* Training Session */}
      {currentTrainingSession ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <Label className="text-base">Today's Training</Label>
              <p className="text-sm font-medium">{currentTrainingSession.name}</p>
              {currentTrainingSession.estimatedCalories && (
                <Badge variant="outline" className="text-xs">
                  <Flame className="h-3 w-3 mr-1" />
                  {currentTrainingSession.estimatedCalories} cal
                </Badge>
              )}
            </div>
            <Switch
              checked={sessionCompleted}
              onCheckedChange={onSessionCompletedChange}
              disabled={!hasLoggedToday && !isExpanded}
            />
          </div>

          {!showSessionPicker && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setShowSessionPicker(true)}
            >
              Do a different session
            </Button>
          )}

          {showSessionPicker && (
            <div className="space-y-2">
              <Select
                value={selectedAlternativeSession || currentTrainingSession.id}
                onValueChange={(value) => {
                  onAlternativeSessionSelect(value === originalScheduledSessionId ? null : value);
                  setShowSessionPicker(false);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allTrainingSessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.name}
                      {session.id === originalScheduledSessionId && " (scheduled)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAlternativeSession && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => setShowSessionPicker(true)}
                >
                  Change session
                </Button>
              )}
            </div>
          )}

          {/* Back to rest day button - always visible when applicable */}
          {originalScheduledSessionId === null && selectedAlternativeSession && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAlternativeSessionSelect(null)}
            >
              Back to rest day
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Label className="text-base">Rest Day</Label>
          {!showSessionPicker ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSessionPicker(true)}
            >
              <Dumbbell className="h-4 w-4 mr-2" />
              Want to train today?
            </Button>
          ) : (
            <Select
              value=""
              onValueChange={(value) => {
                onAlternativeSessionSelect(value);
                setShowSessionPicker(false);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a session..." />
              </SelectTrigger>
              <SelectContent>
                {allTrainingSessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* Planned Activities */}
      {plannedActivities.length > 0 && (
        <div className="space-y-2">
          <Label>Planned Activities</Label>
          {plannedActivities.map((activity) => (
            <div key={activity.sessionId} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{activity.activityName}</span>
                {activity.estimatedCalories > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {activity.estimatedCalories} cal
                  </Badge>
                )}
              </div>
              <Switch
                checked={activityStatuses[activity.sessionId] || false}
                onCheckedChange={(checked) => onActivityToggle(activity.sessionId, checked)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Unplanned Activities */}
      <div className="space-y-2">
        {unplannedActivities.map((activity, index) => (
          <div key={index} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span>{activity.activityName}</span>
              <Badge variant="outline" className="text-xs">
                {activity.intensityLevel} · {activity.durationMinutes}min
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onRemoveUnplannedActivity(index)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}

        {!showAddActivity ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddActivity(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Activity
          </Button>
        ) : (
          <AddActivityForm
            onAdd={handleAddActivity}
            onCancel={() => setShowAddActivity(false)}
          />
        )}
      </div>

      {totalCalories > 0 && (
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Total calories burned</span>
            <Badge className="flex items-center gap-1">
              <Flame className="h-3 w-3" />
              {totalCalories} cal
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}