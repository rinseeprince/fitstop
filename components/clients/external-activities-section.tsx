"use client";

import type { TrainingSession } from "@/types/training";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { ExternalActivityCard } from "./external-activity-card";

type ExternalActivitiesSectionProps = {
  activities: TrainingSession[];
  clientId: string;
  planId: string;
  editMode: boolean;
  onUpdate: () => void;
};

export function ExternalActivitiesSection({
  activities,
  clientId,
  planId,
  editMode,
  onUpdate,
}: ExternalActivitiesSectionProps) {
  if (activities.length === 0) {
    return null;
  }

  const totalCalories = activities.reduce(
    (sum, activity) => sum + (activity.activityMetadata?.estimatedCalories || 0),
    0
  );

  return (
    <div className="space-y-2 mt-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Activity className="h-4 w-4" />
        External Activities
        <Badge variant="secondary" className="text-xs">
          +{totalCalories} cal/week
        </Badge>
      </div>
      {activities.map((activity) => (
        <ExternalActivityCard
          key={activity.id}
          activity={activity}
          clientId={clientId}
          planId={planId}
          editMode={editMode}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
}
