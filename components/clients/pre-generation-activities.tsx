"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { PreGenerationActivityItem } from "./pre-generation-activity-item";
import { PreGenerationActivityForm } from "./pre-generation-activity-form";
import { Plus, ChevronDown, ChevronRight, Activity } from "lucide-react";
import type { PreGenerationActivity } from "@/types/training";

type PreGenerationActivitiesProps = {
  activities: PreGenerationActivity[];
  onAddActivity: (activity: PreGenerationActivity) => void;
  onRemoveActivity: (tempId: string) => void;
  clientWeightKg: number;
};

export function PreGenerationActivities({
  activities,
  onAddActivity,
  onRemoveActivity,
  clientWeightKg,
}: PreGenerationActivitiesProps) {
  const [isOpen, setIsOpen] = useState(activities.length > 0);
  const [showAddForm, setShowAddForm] = useState(false);

  const totalCalories = activities.reduce(
    (sum, a) => sum + (a.analysis?.estimatedCalories || 0),
    0
  );

  const handleAdd = (activity: PreGenerationActivity) => {
    onAddActivity(activity);
    setShowAddForm(false);
  };

  return (
    <div className="border rounded-lg border-dashed border-muted-foreground/30 bg-muted/20">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-4 h-auto"
          >
            <div className="flex items-center gap-2">
              {isOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Activity className="h-4 w-4" />
              <span className="font-medium">External Activities</span>
              {activities.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {activities.length} {activities.length === 1 ? "activity" : "activities"}
                </Badge>
              )}
            </div>
            {activities.length > 0 && totalCalories > 0 && (
              <Badge variant="outline" className="text-orange-600">
                +{totalCalories} cal/week
              </Badge>
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="px-4 pb-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Add any recurring activities (sports, classes, etc.) so the AI can schedule workouts around them.
          </p>

          {activities.length > 0 && (
            <div className="space-y-2">
              {activities.map((activity) => (
                <PreGenerationActivityItem
                  key={activity.tempId}
                  activity={activity}
                  onRemove={() => onRemoveActivity(activity.tempId)}
                />
              ))}
            </div>
          )}

          {showAddForm ? (
            <PreGenerationActivityForm
              clientWeightKg={clientWeightKg}
              onAdd={handleAdd}
              onCancel={() => setShowAddForm(false)}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add External Activity
            </Button>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
