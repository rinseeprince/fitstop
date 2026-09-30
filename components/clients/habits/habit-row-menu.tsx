"use client";

import {
  ChevronDown,
  ChevronUp,
  CirclePause,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";
import type { HabitStatus } from "@/types/habits";

/** What a habit row's ⋯ can do. */
export type HabitRowAction = "change" | "stop" | "start-again" | "rename" | "history" | "move-up" | "move-down" | "delete";

type HabitRowMenuProps = {
  name: string;
  status: HabitStatus;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** A write for the row in flight: the ⋯ spins in its place and waits for the answer. */
  busy: boolean;
  /** A write in flight anywhere on the table: the ⋯ opens nothing until it answers. */
  disabled: boolean;
  onAction: (action: HabitRowAction) => void;
};

/** An item's glyph at the menu's 14px: a `size-` class, so the item's 16px default leaves it be. */
const ITEM_ICON = "size-3.5";

/**
 * A habit row's ⋯ menu (docs/newdesignsystem.md → Dropdown menu). A running
 * or starting-later habit: Change target or days, Stop, Rename, History and
 * the two moves; a stopped one: Start again, Rename and History. Then Delete,
 * on every habit, last behind a separator. Stop and Start again are no
 * deletion, so they are plain items. The ⋯ is always in sight, in the row
 * actions' muted icon style (the owner's drawer rule at commit 2's smoke),
 * and names its habit for a screen reader.
 */
export function HabitRowMenu({ name, status, canMoveUp, canMoveDown, busy, disabled, onAction }: HabitRowMenuProps) {
  const stopped = status === "stopped";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy || disabled}>
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
        {stopped ? (
          <DropdownMenuItem onSelect={() => onAction("start-again")}>
            <RotateCcw className={ITEM_ICON} strokeWidth={1.5} />
            Start again
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => onAction("change")}>
              <SlidersHorizontal className={ITEM_ICON} strokeWidth={1.5} />
              Change target or days
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("stop")}>
              <CirclePause className={ITEM_ICON} strokeWidth={1.5} />
              Stop
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onSelect={() => onAction("rename")}>
          <Pencil className={ITEM_ICON} strokeWidth={1.5} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("history")}>
          <History className={ITEM_ICON} strokeWidth={1.5} />
          History
        </DropdownMenuItem>
        {!stopped && (
          <>
            <DropdownMenuItem disabled={!canMoveUp} onSelect={() => onAction("move-up")}>
              <ChevronUp className={ITEM_ICON} strokeWidth={1.5} />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onSelect={() => onAction("move-down")}>
              <ChevronDown className={ITEM_ICON} strokeWidth={1.5} />
              Move down
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
          <Trash2 className={ITEM_ICON} strokeWidth={1.5} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
