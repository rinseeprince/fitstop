"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDateOnlyShort } from "@/lib/date-helpers";
import { TEXT_SECONDARY } from "@/components/clients/training/program-builder/builder-tokens";
import { EditHabitInline, type HabitEditMode } from "./edit-habit-inline";
import { HabitActions } from "./habit-actions";
import type { HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabit } from "@/types/habits";

type HabitListItemProps = {
  habit: CoachHabit;
  /** The client's today: when an upcoming habit starts, and the day an edited target runs from. */
  clientToday: string;
  /** Why the row's form is open; null: the row, not the form. */
  editMode: HabitEditMode | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  writes: HabitWrites;
  onEdit: () => void;
  onCloseEdit: () => void;
  onStop: () => void;
  onDelete: () => void;
  onStartAgain: () => Promise<void>;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

/** Line 2's one text style, every status alike; the how-to under it wears it too. */
const LINE_TWO_CLASS = cn("text-xs", TEXT_SECONDARY);

/**
 * Line 2: a running habit's days, then its target; one starting later, the
 * day it starts, then the same; a stopped habit, "Stopped" alone.
 */
function describe(habit: CoachHabit, clientToday: string): string | null {
  if (habit.status === "stopped") return "Stopped";
  const startsOn =
    habit.status === "upcoming" ? (habit.versions.find((version) => version.startsOn > clientToday)?.startsOn ?? null) : null;
  const parts = [startsOn === null ? null : `Starts ${formatDateOnlyShort(startsOn)}`, habit.words.schedule, habit.words.target].filter(
    (part): part is string => part !== null
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export const HabitListItem = ({
  habit,
  clientToday,
  editMode,
  canMoveUp,
  canMoveDown,
  writes,
  onEdit,
  onCloseEdit,
  onStop,
  onDelete,
  onStartAgain,
  onMoveUp,
  onMoveDown,
}: HabitListItemProps) => {
  const [isStarting, setIsStarting] = useState(false);

  if (editMode) {
    return <EditHabitInline habit={habit} clientToday={clientToday} mode={editMode} writes={writes} onClose={onCloseEdit} />;
  }

  const stopped = habit.status === "stopped";
  const words = describe(habit, clientToday);

  const startAgain = async () => {
    setIsStarting(true);
    try {
      await onStartAgain();
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div
      className={cn(
        "group relative px-3 py-2.5 rounded-lg transition-all duration-150 hover:bg-muted/50",
        stopped && "opacity-60"
      )}
    >
      {/* Line 1: the name, and the row's ⋯ menu at the far right */}
      <div className="flex items-center gap-2">
        {/* A name too long for the row ends in "…"; the ⋯ stays whole. */}
        <p className={cn("min-w-0 flex-1 truncate text-sm font-medium", stopped && "text-muted-foreground")}>{habit.name}</p>
        <HabitActions
          name={habit.name}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          busy={isStarting}
          onEdit={onEdit}
          onStop={stopped ? undefined : onStop}
          // Every stopped habit starts again, a version left or not: the drawer's `startAgain` decides how.
          onStartAgain={stopped ? () => void startAgain() : undefined}
          onDelete={habit.hasEntries ? undefined : onDelete}
          onMoveUp={stopped ? undefined : onMoveUp}
          onMoveDown={stopped ? undefined : onMoveDown}
        />
      </div>

      {/* Line 2: where it stands, its days and its target; its how-to under it.
          A stopped habit says "Stopped" and nothing more. */}
      {(words || habit.howTo) && (
        <div className="mt-1">
          {words && <p className={LINE_TWO_CLASS}>{words}</p>}
          {habit.howTo && !stopped && <p className={cn(LINE_TWO_CLASS, "mt-0.5 line-clamp-1")}>{habit.howTo}</p>}
        </div>
      )}
    </div>
  );
};
