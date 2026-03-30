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
import { Plus, ChevronRight, Activity } from "lucide-react";
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
    <div className="border border-dashed border-[rgba(13,148,136,0.12)] bg-[rgba(13,148,136,0.02)] rounded-[6px]">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-4 h-auto hover:bg-[rgba(13,148,136,0.03)]"
          >
            <div className="flex items-center gap-2">
              <ChevronRight
                className={`h-4 w-4 text-[#93b0b4] transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
              />
              <Activity className="h-4 w-4 text-[#93b0b4]" strokeWidth={1.5} />
              <span className="text-[13px] font-medium text-[#93b0b4]">External Activities</span>
              {activities.length > 0 && (
                <Badge variant="secondary" className="ml-1 bg-[rgba(13,148,136,0.05)] text-[#0d9488] border-0 text-[11px]">
                  {activities.length}
                </Badge>
              )}
            </div>
            {activities.length > 0 && totalCalories > 0 && (
              <Badge variant="outline" className="border-[rgba(13,148,136,0.08)] text-[#c8923a] text-[11px]">
                +{totalCalories} cal/wk
              </Badge>
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="px-4 pb-4 space-y-3">
          <p className="text-[12px] text-[#93b0b4] leading-[1.4]">
            Add any recurring activities (swimming, cycling, BJJ, etc.) so the AI can schedule workouts around them.
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
              className="w-full border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:bg-[rgba(13,148,136,0.03)] hover:border-[rgba(13,148,136,0.2)] rounded-[6px]"
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
