"use client";

import { ChevronDown, Copy, GripVertical, Trash2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeekDraft } from "./program-builder-types";
import {
  MONO_LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// The sticky left-column card for one week: number, sessions-vs-rest summary,
// collapse chevron, and (edit mode) duplicate/delete + the drag grip that
// reorders weeks. Reordering is drag-only — no up/down buttons.
type WeekCardProps = {
  week: WeekDraft;
  mode: "view" | "edit";
  collapsed: boolean;
  canDelete: boolean;
  onToggleCollapse: () => void;
  onDuplicate: () => void;
  // Opens the progression dialog (duplicate + rule + preview). Plain
  // Duplicate stays one-click — these are sibling affordances by design.
  onDuplicateWithProgression: () => void;
  onDelete: () => void;
  // useSortable attributes+listeners from week-row — grip-only drag.
  dragHandleProps?: Record<string, unknown>;
};

export function WeekCard({
  week,
  mode,
  collapsed,
  canDelete,
  onToggleCollapse,
  onDuplicate,
  onDuplicateWithProgression,
  onDelete,
  dragHandleProps,
}: WeekCardProps) {
  const trainingCount = week.days.filter((d) => !d.isRest).length;
  const restCount = week.days.length - trainingCount;

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-[6px] bg-white p-3",
        TRAINING_CARD_BORDER,
        collapsed ? "min-h-9 justify-center py-1.5" : "min-h-[92px]",
      )}
    >
      <div className="flex items-center gap-1">
        {mode === "edit" && (
          <button
            type="button"
            aria-label={`Drag week ${week.weekIndex + 1}`}
            className={cn(
              "-ml-1.5 cursor-grab rounded p-1 hover:bg-[rgba(13,148,136,0.08)] active:cursor-grabbing",
              TEXT_MUTED,
            )}
            {...dragHandleProps}
          >
            <GripVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
        <span className={cn("text-sm font-semibold", TEXT_PRIMARY)}>
          Week {week.weekIndex + 1}
        </span>
        <button
          type="button"
          aria-label={collapsed ? "Expand week" : "Collapse week"}
          aria-expanded={!collapsed}
          className={cn("ml-auto rounded p-1 hover:bg-[rgba(13,148,136,0.08)]", TEXT_SECONDARY)}
          onClick={onToggleCollapse}
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-200",
              collapsed && "-rotate-90",
            )}
            strokeWidth={1.5}
          />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className={cn("mt-1", MONO_LABEL_CLASS)}>
            {trainingCount} {trainingCount === 1 ? "session" : "sessions"} · {restCount} rest
          </div>
          {mode === "edit" && (
            <div className="mt-auto flex items-center gap-1 border-t border-[rgba(13,148,136,0.06)] pt-2">
              <button
                type="button"
                aria-label={`Duplicate week ${week.weekIndex + 1}`}
                className={cn(
                  "flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-[11px] hover:bg-[rgba(13,148,136,0.08)]",
                  TEXT_SECONDARY,
                )}
                onClick={onDuplicate}
              >
                <Copy className="h-3 w-3" strokeWidth={1.5} /> Duplicate
              </button>
              <button
                type="button"
                aria-label={`Duplicate week ${week.weekIndex + 1} with progression`}
                title="Duplicate with progression"
                className={cn(
                  "rounded p-1 hover:bg-[rgba(13,148,136,0.08)]",
                  TEXT_SECONDARY,
                )}
                onClick={onDuplicateWithProgression}
              >
                <TrendingUp className="h-3 w-3" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label={`Delete week ${week.weekIndex + 1}`}
                disabled={!canDelete}
                className={cn(
                  "ml-auto rounded p-1",
                  canDelete
                    ? "text-destructive hover:bg-red-50"
                    : cn(TEXT_MUTED, "cursor-not-allowed opacity-50"),
                )}
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
