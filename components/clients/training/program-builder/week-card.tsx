"use client";

import { ChevronDown, Copy, GripVertical, Trash2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeekDraft } from "./program-builder-types";
import { MONO, TEXT_MUTED, TEXT_SECONDARY } from "./builder-tokens";

// The slim 42px week column (reference `.wk`): a `W#` teal chip + the week's
// session-count frequency, NOT a card. All week controls (grip-reorder,
// collapse, duplicate, duplicate-with-progression, delete) live in a
// hover-revealed vertical stack below the chip — nothing is lost, the column
// just stays narrow like the mockup. Edit controls only surface when the week
// is expanded (a collapsed row is too short to host them); collapse itself is
// always reachable on hover in both modes.
type WeekCardProps = {
  week: WeekDraft;
  mode: "view" | "edit";
  collapsed: boolean;
  canDelete: boolean;
  // Placed-plan lock policies (default true — no locking): a fully-elapsed
  // week can't be duplicated/progressed (decision 8); a week touching history
  // can't be reordered, so its grip hides.
  canDuplicate?: boolean;
  canReorder?: boolean;
  onToggleCollapse: () => void;
  onDuplicate: () => void;
  // Opens the progression dialog (duplicate + rule + preview). Plain
  // Duplicate stays one-click — these are sibling affordances by design.
  onDuplicateWithProgression: () => void;
  onDelete: () => void;
  // useSortable attributes+listeners from week-row — grip-only drag.
  dragHandleProps?: Record<string, unknown>;
};

const CTRL_BTN =
  "grid h-5 w-5 place-items-center rounded hover:bg-[rgba(13,148,136,0.08)]";

export function WeekCard({
  week,
  mode,
  collapsed,
  canDelete,
  canDuplicate = true,
  canReorder = true,
  onToggleCollapse,
  onDuplicate,
  onDuplicateWithProgression,
  onDelete,
  dragHandleProps,
}: WeekCardProps) {
  const trainingCount = week.days.filter((d) => !d.isRest).length;
  const editControls = mode === "edit" && !collapsed;

  return (
    <div className="group/wk flex flex-col items-center gap-1 pt-2.5">
      <span className={cn(MONO, "rounded-[6px] bg-[rgba(13,148,136,0.08)] px-[7px] py-1 text-[10.5px] font-semibold text-[#0a5c55]")}>
        W{week.weekIndex + 1}
      </span>
      {!collapsed && (
        <span className={cn(MONO, "text-[9.5px] text-[#c2d0cc]")}>
          {trainingCount}×
        </span>
      )}

      {/* Hover-revealed control stack — hidden (no layout cost) until hover. */}
      <div className={cn("hidden flex-col items-center gap-0.5 pt-0.5 group-hover/wk:flex", TEXT_SECONDARY)}>
        {editControls && canReorder && (
          <button
            type="button"
            aria-label={`Drag week ${week.weekIndex + 1}`}
            className={cn(CTRL_BTN, "cursor-grab active:cursor-grabbing", TEXT_MUTED)}
            {...dragHandleProps}
          >
            <GripVertical className="h-3 w-3" strokeWidth={1.5} />
          </button>
        )}
        <button
          type="button"
          aria-label={collapsed ? "Expand week" : "Collapse week"}
          aria-expanded={!collapsed}
          className={CTRL_BTN}
          onClick={onToggleCollapse}
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform duration-200", collapsed && "-rotate-90")}
            strokeWidth={1.5}
          />
        </button>
        {editControls && (
          <>
            <button
              type="button"
              aria-label={`Duplicate week ${week.weekIndex + 1}`}
              title="Duplicate week"
              disabled={!canDuplicate}
              className={cn(
                CTRL_BTN,
                !canDuplicate &&
                  cn(TEXT_MUTED, "cursor-not-allowed opacity-40 hover:bg-transparent"),
              )}
              onClick={onDuplicate}
            >
              <Copy className="h-3 w-3" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label={`Duplicate week ${week.weekIndex + 1} with progression`}
              title="Duplicate with progression"
              disabled={!canDuplicate}
              className={cn(
                CTRL_BTN,
                !canDuplicate &&
                  cn(TEXT_MUTED, "cursor-not-allowed opacity-40 hover:bg-transparent"),
              )}
              onClick={onDuplicateWithProgression}
            >
              <TrendingUp className="h-3 w-3" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label={`Delete week ${week.weekIndex + 1}`}
              title="Delete week"
              disabled={!canDelete}
              className={cn(
                CTRL_BTN,
                canDelete
                  ? "text-destructive hover:bg-red-50"
                  : cn(TEXT_MUTED, "cursor-not-allowed opacity-40 hover:bg-transparent"),
              )}
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
