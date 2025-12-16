"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dumbbell, Activity, Clock, Flame, X, GripVertical } from "lucide-react";
import type { TrainingSession } from "@/types/training";

type WeeklyScheduleItemProps = {
  item: TrainingSession;
  compact?: boolean;
  editMode?: boolean;
  onDelete?: () => void;
};

const INTENSITY_COLORS = {
  low: "bg-green-500",
  moderate: "bg-yellow-500",
  vigorous: "bg-red-500",
};

export function WeeklyScheduleItem({
  item,
  compact,
  editMode,
  onDelete,
}: WeeklyScheduleItemProps) {
  const isActivity = item.sessionType === "external_activity";
  const metadata = item.activityMetadata;
  const showDelete = editMode && isActivity && onDelete;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "rounded-md p-2 text-xs transition-colors cursor-default relative group",
              isActivity
                ? "bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800"
                : "bg-primary/10 border border-primary/20"
            )}
          >
            {showDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
            <div className="flex items-start gap-1.5">
              {editMode && (
                <GripVertical className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
              )}
              {isActivity ? (
                <Activity className="h-3 w-3 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
              ) : (
                <Dumbbell className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{item.name}</p>
                {!compact && item.focus && (
                  <p className="text-muted-foreground truncate text-[10px]">
                    {item.focus}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between mt-1.5">
              {item.estimatedDurationMinutes && (
                <span className="flex items-center gap-0.5 text-muted-foreground">
                  <Clock className="h-2.5 w-2.5" />
                  {item.estimatedDurationMinutes}m
                </span>
              )}
              {isActivity && metadata?.intensityLevel && (
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    INTENSITY_COLORS[metadata.intensityLevel]
                  )}
                />
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <ItemTooltipContent item={item} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ItemTooltipContent({ item }: { item: TrainingSession }) {
  const isActivity = item.sessionType === "external_activity";
  const metadata = item.activityMetadata;

  return (
    <div className="space-y-2">
      <div>
        <p className="font-medium">{item.name}</p>
        {item.focus && (
          <p className="text-sm text-muted-foreground">{item.focus}</p>
        )}
      </div>

      {isActivity && metadata && (
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {metadata.intensityLevel}
            </Badge>
            <span className="flex items-center gap-1">
              <Flame className="h-3 w-3 text-orange-500" />
              {metadata.estimatedCalories} cal
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-blue-500" />
              {metadata.recoveryHours}h recovery
            </span>
          </div>
          {metadata.muscleGroupsImpacted.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {metadata.muscleGroupsImpacted.map((muscle) => (
                <Badge key={muscle} variant="secondary" className="text-xs">
                  {muscle}
                </Badge>
              ))}
            </div>
          )}
          {metadata.recoveryImpact && (
            <p className="text-xs text-muted-foreground">
              {metadata.recoveryImpact}
            </p>
          )}
        </div>
      )}

      {!isActivity && (
        <div className="text-sm">
          {item.exercises.length > 0 && (
            <p className="text-muted-foreground">
              {item.exercises.length} exercises
            </p>
          )}
          {item.notes && (
            <p className="text-xs text-muted-foreground mt-1">
              {item.notes}
            </p>
          )}
        </div>
      )}

      {item.estimatedDurationMinutes && (
        <p className="text-xs text-muted-foreground">
          ~{item.estimatedDurationMinutes} minutes
        </p>
      )}
    </div>
  );
}
