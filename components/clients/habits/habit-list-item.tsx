"use client";

import { cn } from "@/lib/utils";
import { CompletionBadge } from "./completion-badge";
import { EditHabitInline } from "./edit-habit-inline";
import { HabitActions } from "./habit-actions";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import type { DailyHabit, DailyHabitInput } from "@/types/daily-habit";
import type { HabitStats } from "@/services/daily-habits-stats";

interface HabitWithStats extends DailyHabit {
  stats?: HabitStats;
}

type HabitListItemProps = {
  habit: HabitWithStats;
  isSelected: boolean;
  isEditing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClick: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (data: Partial<DailyHabitInput>) => Promise<void>;
  onDelete: () => void;
  onReactivate?: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

export const HabitListItem = ({
  habit,
  isSelected,
  isEditing,
  canMoveUp,
  canMoveDown,
  onClick,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReactivate,
  onMoveUp,
  onMoveDown,
}: HabitListItemProps) => {
  if (isEditing) {
    return (
      <EditHabitInline
        habit={habit}
        onSave={onSaveEdit}
        onCancel={onCancelEdit}
      />
    );
  }

  return (
    <div
      className={cn(
        "group relative px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150",
        !habit.isActive && "opacity-60",
        isSelected
          ? "bg-primary/10"
          : "hover:bg-muted/50"
      )}
      onClick={onClick}
    >
      {/* Row 1: Name and Completion Badge */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <p className={cn(
            "text-sm font-medium line-clamp-1",
            !habit.isActive && "text-muted-foreground"
          )}>
            {habit.name}
          </p>
          {!habit.isActive && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Completion Badge */}
          {habit.stats && (
            <CompletionBadge completionRate={habit.stats.completionRate} />
          )}
          {/* Actions - visible on hover */}
          {habit.isActive ? (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <HabitActions
                canMoveUp={canMoveUp}
                canMoveDown={canMoveDown}
                onEdit={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                onDelete={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                onMoveUp={(e) => {
                  e.stopPropagation();
                  onMoveUp();
                }}
                onMoveDown={(e) => {
                  e.stopPropagation();
                  onMoveDown();
                }}
              />
            </div>
          ) : (
            onReactivate && (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReactivate();
                  }}
                  className="h-7 px-2 text-xs"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reactivate
                </Button>
              </div>
            )
          )}
        </div>
      </div>

      {/* Row 2: Type indicator (only for numeric) and description */}
      {(!habit.isBoolean || habit.description) && (
        <div className="mt-1">
          {/* Type indicator - only show for numeric habits */}
          {!habit.isBoolean && habit.targetValue && habit.targetUnit && (
            <p className="text-xs text-muted-foreground">
              {habit.targetValue} {habit.targetUnit}
            </p>
          )}
          {/* Description if exists */}
          {habit.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {habit.description}
            </p>
          )}
        </div>
      )}
    </div>
  );
};