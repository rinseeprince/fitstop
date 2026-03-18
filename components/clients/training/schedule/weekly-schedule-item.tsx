"use client";

import { memo } from "react";
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
  low: "bg-success",
  moderate: "bg-warning",
  vigorous: "bg-destructive",
};

export const WeeklyScheduleItem = memo(function WeeklyScheduleItem({
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
              "rounded-lg p-2 text-xs transition-all duration-150 cursor-default relative group",
              isActivity
                ? "bg-card border border-primary/20"
                : "bg-card border border-secondary/20"
            )}
          >
            {showDelete && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${item.name}`}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
            )}
            <div className="flex items-start gap-1.5">
              {editMode && (
                <GripVertical className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" aria-label="Drag to reorder" />
              )}
              {isActivity ? (
                <Activity className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
              ) : (
                <Dumbbell className="h-3 w-3 mt-0.5 shrink-0 text-secondary" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{item.name}</p>
                {!compact && item.focus && (
                  <p className="text-muted-foreground truncate text-[11px]">
                    {item.focus}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between mt-1.5">
              {item.estimatedDurationMinutes && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {item.estimatedDurationMinutes}m
                </span>
              )}
              {isActivity && metadata?.intensityLevel && (
                <div
                  role="img"
                  aria-label={`${metadata.intensityLevel} intensity`}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    INTENSITY_COLORS[metadata.intensityLevel]
                  )}
                />
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs bg-card rounded-lg shadow-md border border-border p-4">
          <ItemTooltipContent item={item} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

function ItemTooltipContent({ item }: { item: TrainingSession }) {
  const isActivity = item.sessionType === "external_activity";
  const metadata = item.activityMetadata;

  return (
    <div className="space-y-2">
      <div>
        <p className="font-medium text-foreground">{item.name}</p>
        {item.focus && (
          <p className="text-sm text-muted-foreground">{item.focus}</p>
        )}
      </div>

      {isActivity && metadata && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-secondary/15 text-secondary capitalize">
              {metadata.intensityLevel}
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Flame className="h-3 w-3 text-warning" />
              {metadata.estimatedCalories} cal
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3 text-primary" />
              {metadata.recoveryHours}h recovery
            </span>
          </div>
          {metadata.muscleGroupsImpacted.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {metadata.muscleGroupsImpacted.map((muscle) => (
                <span key={muscle} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-secondary/15 text-secondary">
                  {muscle}
                </span>
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
