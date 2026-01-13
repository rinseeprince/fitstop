"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { X, Flame, Clock, Info } from "lucide-react";
import type { PreGenerationActivity } from "@/types/training";

type PreGenerationActivityItemProps = {
  activity: PreGenerationActivity;
  onRemove: () => void;
};

const INTENSITY_COLORS = {
  low: "bg-success/15 text-success",
  moderate: "bg-warning/15 text-warning",
  vigorous: "bg-destructive/15 text-destructive",
};

export function PreGenerationActivityItem({
  activity,
  onRemove,
}: PreGenerationActivityItemProps) {
  const dayLabel = activity.dayOfWeek.charAt(0).toUpperCase() + activity.dayOfWeek.slice(1);

  return (
    <div className="flex items-center justify-between p-3 bg-background rounded-lg border">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex flex-col min-w-0">
          <span className="font-medium truncate">{activity.activityName}</span>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="text-xs">
              {dayLabel}
            </Badge>
            <span>{activity.durationMinutes}min</span>
            <Badge className={`text-xs ${INTENSITY_COLORS[activity.intensityLevel]}`}>
              {activity.intensityLevel}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {activity.analysis && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Flame className="h-3 w-3 text-warning" />
              {activity.analysis.estimatedCalories}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-primary" />
              {activity.analysis.recoveryHours}h
            </span>
            {activity.analysis.recoveryImpact && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">{activity.analysis.recoveryImpact}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {activity.analysis.muscleGroupsImpacted.map((muscle) => (
                        <Badge key={muscle} variant="secondary" className="text-xs">
                          {muscle}
                        </Badge>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
