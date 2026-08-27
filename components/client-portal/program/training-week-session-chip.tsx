"use client";

import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { WeekLayoutEntry } from "@/lib/week-layout";
import {
  stateClass,
  stateLabel,
} from "@/components/client-portal/training/session-state";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";

/**
 * One session in the week view: name, focus, "moved from Thu" while a move is
 * unsaved, and the state chip the picker uses. A button only while it can be
 * picked up — the parent hands over the row as the tap target once one is.
 */
export function SessionChip({
  entry,
  selectable,
  isSelected,
  onPickUp,
}: {
  entry: WeekLayoutEntry;
  /** False while a session is picked up (the row is the button then) and while saving. */
  selectable: boolean;
  isSelected: boolean;
  onPickUp: (session: ClientTrainingWeekSession) => void;
}) {
  const { session, pendingFrom } = entry;
  const movedFrom = pendingFrom
    ? `moved from ${format(new Date(pendingFrom + "T00:00:00"), "EEE")}`
    : null;
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[#0c1a1e]">{session.name}</span>
        {(session.focus || movedFrom) && (
          <span className="block text-[11px] text-[#5a7d82]">
            {[session.focus, movedFrom].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      <span className={`shrink-0 rounded-[6px] px-2 py-0.5 text-[11px] ${stateClass(session.state)}`}>
        {stateLabel(session.state)}
      </span>
    </>
  );
  const chipClass = cn(
    "flex w-full items-center gap-2 rounded-[6px] border px-2.5 py-1.5",
    isSelected ? "border-[#0d9488] bg-[rgba(13,148,136,0.05)]" : "border-[rgba(13,148,136,0.08)]",
  );

  // Only a still-scheduled session can be picked up: a logged or skipped day is
  // pinned (the server refuses it too).
  if (selectable && session.isScheduled) {
    return (
      <button
        type="button"
        className={cn(chipClass, "text-left transition-colors hover:bg-[rgba(13,148,136,0.04)]")}
        onClick={() => onPickUp(session)}
      >
        {body}
      </button>
    );
  }
  return <span className={chipClass}>{body}</span>;
}
