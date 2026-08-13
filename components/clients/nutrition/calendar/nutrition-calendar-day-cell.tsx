"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { Pencil, StickyNote } from "lucide-react";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import type { NutritionEvent } from "@/types/check-in";

type NutritionCalendarDayCellProps = {
  date: string;
  dayOfMonth: number;
  event: NutritionEvent | null;
  isToday: boolean;
  isPast: boolean;
  isOutsideMonth?: boolean;
  /** Activity-burn toggle — the cell shows the same total the rest of the builder does. */
  includeActivityBurn: boolean;
  /** How a training-day surplus distributes across macros. */
  surplusAsCarbs?: boolean;
  /** Edit mode (◆2) — eligible cells become click-to-select targets. */
  editMode?: boolean;
  isSelected?: boolean;
  onToggle?: (date: string) => void;
};

export const NutritionCalendarDayCell = memo(function NutritionCalendarDayCell({
  date,
  dayOfMonth,
  event,
  isToday,
  isPast,
  isOutsideMonth,
  includeActivityBurn,
  surplusAsCarbs,
  editMode,
  isSelected,
  onToggle,
}: NutritionCalendarDayCellProps) {
  const target = event
    ? mapNutritionEventToDisplayTarget(event, includeActivityBurn, surplusAsCarbs)
    : null;
  const hasAnyNote = Boolean(event?.coachNote || event?.note);
  // Eligible to edit = today-forward + a scheduled event (mirrors the server guard).
  const isEligible =
    !!editMode && !isPast && !!event && event.status === "scheduled";

  return (
    <div
      data-date={date}
      onClick={isEligible && onToggle ? () => onToggle(date) : undefined}
      className={cn(
        "min-h-[96px] rounded-[6px] border border-[rgba(13,148,136,0.06)] p-1.5 flex flex-col gap-1 relative transition-all",
        isOutsideMonth && "opacity-40",
        isPast && !isOutsideMonth && "opacity-60",
        isToday && !isSelected && "ring-1 ring-[#0d9488]",
        isEligible &&
          "cursor-pointer hover:border-[rgba(13,148,136,0.25)] hover:bg-[rgba(13,148,136,0.03)]",
        isSelected && "ring-2 ring-[#0d9488]/35 bg-[rgba(13,148,136,0.05)]"
      )}
    >
      {/* Header row: TRAIN badge (left) + date number (right) */}
      <div className="flex items-center justify-between leading-none">
        {event?.isTrainingDay ? (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[9px] font-semibold bg-[#0d9488] text-white uppercase">
            Train
          </span>
        ) : (
          <span />
        )}
        <span
          className={cn(
            MONO,
            "text-[10px] font-medium",
            isToday ? "text-[#0d9488] font-semibold" : "text-[#93b0b4]"
          )}
        >
          {dayOfMonth}
        </span>
      </div>

      {target ? (
        <div className="flex flex-col gap-1 mt-auto">
          <div className="flex items-baseline gap-1">
            <span className={cn(MONO, "text-[15px] font-bold leading-none text-[#0c1a1e]")}>
              {target.calories.toLocaleString()}
            </span>
            <span className="text-[8px] text-[#93b0b4]">kcal</span>
            {/* Trailing glyph cluster. `ml-auto` sits on the CLUSTER, not on
                whichever glyph happens to be first — the previous hand-wired
                ml-auto/ml-1 handoff only worked for exactly two. */}
            {(hasAnyNote || event?.isModified) && (
              <span className="ml-auto flex flex-shrink-0 items-center gap-1">
                {hasAnyNote && (
                  <NoteButton
                    date={date}
                    coachNote={event?.coachNote ?? null}
                    clientNote={event?.note ?? null}
                  />
                )}
                {event?.isModified && (
                  <Pencil
                    className="h-3 w-3 text-[#93b0b4]"
                    strokeWidth={1.5}
                    aria-label="Edited"
                  />
                )}
              </span>
            )}
          </div>
          <div className="flex h-[4px] rounded-full overflow-hidden">
            <div className="bg-protein" style={{ width: `${target.proteinPercent}%` }} />
            <div className="bg-carbs" style={{ width: `${target.carbsPercent}%` }} />
            <div className="bg-fat" style={{ width: `${target.fatPercent}%` }} />
          </div>
          <p className={cn(MONO, "text-[9px] flex gap-1 leading-none")}>
            <span className="text-protein">{target.proteinG}p</span>
            <span className="text-carbs">{target.carbsG}c</span>
            <span className="text-fat">{target.fatG}f</span>
          </p>
        </div>
      ) : (
        !isPast && !isOutsideMonth && (
          <span className="text-[10px] text-[#93b0b4] mt-auto">&mdash;</span>
        )
      )}
    </div>
  );
});

/**
 * The note marker.
 *
 * Replaces a `<StickyNote>` carrying a native SVG `<title>`, which had three
 * problems: it was not focusable or clickable (mouse-hover only, after the
 * browser's ~1s dwell), its `aria-label` WON the accessible-name computation
 * so a screen reader announced "Has a coach note" and never the note text, and
 * that label described `note` — the client-facing column — while calling it a
 * coach note.
 *
 * Now a real button whose accessible name says how many notes and for whom,
 * opening the design system's 320px popover. `stopPropagation` is load-bearing:
 * in edit mode the parent cell is itself a click target for day selection.
 */
function NoteButton({
  date,
  coachNote,
  clientNote,
}: {
  date: string;
  coachNote: string | null;
  clientNote: string | null;
}) {
  const [open, setOpen] = useState(false);

  // The two notes are NOT flattened into one visibility claim, because their
  // visibility genuinely differs. `note` (mig 118) renders on the client's
  // nutrition day card unconditionally — "shown". `coach_note` is the plan-save
  // note, whose text is mirrored into nutrition_plan_notes (mig 147) and
  // reaches the client only while the journey block containing it is current —
  // "shared". It is no longer private either way, which is the part a coach
  // must not misread; the old "Your note" said the opposite.
  const label = coachNote
    ? clientNote
      ? "A plan change note shared with the client, and a day note shown to them"
      : "A plan change note shared with the client"
    : "A day note shown to the client";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            FOCUS_RING,
            "rounded-[4px] text-[#0d9488] transition-colors hover:text-[#0b7f75]"
          )}
        >
          <StickyNote className="h-3 w-3" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
        className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0"
      >
        <div className="px-3.5 pb-2 pt-3">
          <p className={cn(MONO, "text-sm font-semibold text-[#0c1a1e]")}>
            {format(new Date(date + "T00:00:00"), "EEEE, MMM d")}
          </p>
          <p className={MONO_LABEL_CLASS}>{coachNote && clientNote ? "2 notes" : "1 note"}</p>
        </div>
        <div className="max-h-[260px] space-y-3 overflow-y-auto px-3.5 pb-3">
          {coachNote && (
            <div className="space-y-1">
              <p className={LABEL_CLASS}>Plan change &middot; shared with the client</p>
              <p className="whitespace-pre-wrap text-[12.5px] leading-[1.45] text-[#0c1a1e]">
                {coachNote}
              </p>
            </div>
          )}
          {clientNote && (
            <div className="space-y-1">
              <p className={LABEL_CLASS}>Day note &middot; shown to the client</p>
              <p className="whitespace-pre-wrap text-[12.5px] leading-[1.45] text-[#0c1a1e]">
                {clientNote}
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
