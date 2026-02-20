"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Activity, X, Plus } from "lucide-react";
import { AddActivityForm } from "./add-activity-form";
import type { UnplannedActivity, TodaysActivity } from "./daily-pulse-content";

interface ActivityListProps {
  plannedActivities: TodaysActivity[];
  unplannedActivities: UnplannedActivity[];
  activityStatuses: Record<string, { completed: boolean; activityName: string; estimatedCalories: number }>;
  showAddActivity: boolean;
  setShowAddActivity: (show: boolean) => void;
  onActivityToggle: (activityId: string, checked: boolean) => void;
  onAddUnplannedActivity: (activity: UnplannedActivity) => void;
  onRemoveUnplannedActivity: (index: number) => void;
}

export function ActivityList({
  plannedActivities,
  unplannedActivities,
  activityStatuses,
  showAddActivity,
  setShowAddActivity,
  onActivityToggle,
  onAddUnplannedActivity,
  onRemoveUnplannedActivity,
}: ActivityListProps) {
  return (
    <>
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
                checked={activityStatuses[activity.sessionId]?.completed || false}
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
            Log additional activity
          </Button>
        ) : (
          <AddActivityForm
            onAdd={(activity) => {
              onAddUnplannedActivity(activity);
              setShowAddActivity(false);
            }}
            onCancel={() => setShowAddActivity(false)}
          />
        )}
      </div>
    </>
  );
}