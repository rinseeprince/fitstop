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
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  moderate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  vigorous: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
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
              <Flame className="h-3 w-3 text-orange-500" />
              {activity.analysis.estimatedCalories}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-blue-500" />
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
