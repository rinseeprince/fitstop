"use client";

import { ChevronDown, ChevronUp, CirclePause, Loader2, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";

type HabitActionsProps = {
  name: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** A write for the row in flight: the button spins in the ⋯'s place and waits for its answer. */
  busy: boolean;
  onEdit: () => void;
  /** Absent on a stopped habit: it is started again instead. */
  onStop?: () => void;
  /** A stopped habit's alone: a running or upcoming one is stopped instead. */
  onStartAgain?: () => void;
  onDelete: () => void;
  /** Absent on a stopped habit: it sits below the running and upcoming ones and never moves. */
  onMoveUp?: () => void;
  /** Absent on a stopped habit, like Move up. */
  onMoveDown?: () => void;
};

/** An item's glyph at the menu's 14px: a `size-` class, so the item's 16px default leaves it be. */
const ITEM_ICON = "size-3.5";

/**
 * A habit row's ⋯ menu (docs/newdesignsystem.md → Dropdown menu): Edit, Stop
 * and the two moves on a running or upcoming habit; Start again and Edit on a
 * stopped one; then Delete, on every habit, last behind a separator. Stop is
 * no deletion (a stopped habit starts again), so it is a plain item. The ⋯ is
 * always in sight, in the row actions' muted icon style, and names its habit
 * for a screen reader.
 */
export const HabitActions = ({
  name,
  canMoveUp,
  canMoveDown,
  busy,
  onEdit,
  onStop,
  onStartAgain,
  onDelete,
  onMoveUp,
  onMoveDown,
}: HabitActionsProps) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy}>
        <button
          type="button"
          aria-label={`Actions for ${name}`}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[#93b0b4] transition-colors duration-150 hover:bg-[#f0f5f4] hover:text-[#5a7d82] data-[state=open]:bg-[#f0f5f4] data-[state=open]:text-[#5a7d82] disabled:pointer-events-none",
            FOCUS_RING
          )}
        >
          {busy ? (
            <Loader2 className="h-[15px] w-[15px] animate-spin" strokeWidth={1.5} />
          ) : (
            <MoreHorizontal className="h-[15px] w-[15px]" strokeWidth={1.5} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onStartAgain && (
          <DropdownMenuItem onSelect={onStartAgain}>
            <RotateCcw className={ITEM_ICON} strokeWidth={1.5} />
            Start again
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className={ITEM_ICON} strokeWidth={1.5} />
          Edit
        </DropdownMenuItem>
        {onStop && (
          <DropdownMenuItem onSelect={onStop}>
            <CirclePause className={ITEM_ICON} strokeWidth={1.5} />
            Stop
          </DropdownMenuItem>
        )}
        {onMoveUp && (
          <DropdownMenuItem disabled={!canMoveUp} onSelect={onMoveUp}>
            <ChevronUp className={ITEM_ICON} strokeWidth={1.5} />
            Move up
          </DropdownMenuItem>
        )}
        {onMoveDown && (
          <DropdownMenuItem disabled={!canMoveDown} onSelect={onMoveDown}>
            <ChevronDown className={ITEM_ICON} strokeWidth={1.5} />
            Move down
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 className={ITEM_ICON} strokeWidth={1.5} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
