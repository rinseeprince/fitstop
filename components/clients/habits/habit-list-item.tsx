"use client";

import { cn } from "@/lib/utils";
import { CompletionBadge } from "./completion-badge";
import { EditHabitInline } from "./edit-habit-inline";
import { HabitActions } from "./habit-actions";
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
        isSelected
          ? "bg-primary/10 shadow-sm"
          : "hover:bg-gray-50"
      )}
      onClick={onClick}
    >
      {/* Row 1: Name and Completion Badge */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium line-clamp-1 flex-1">
          {habit.name}
        </p>
        <div className="flex items-center gap-2">
          {/* Completion Badge */}
          {habit.stats && (
            <CompletionBadge completionRate={habit.stats.completionRate} />
          )}
          {/* Actions - visible on hover */}
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
        </div>
      </div>

      {/* Row 2: Type indicator (only for numeric) and description */}
      {(!habit.isBoolean || habit.description) && (
        <div className="mt-1">
          {/* Type indicator - only show for numeric habits */}
          {!habit.isBoolean && habit.targetValue && habit.targetUnit && (
            <p className="text-xs text-gray-400">
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