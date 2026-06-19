"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import type { NutritionEvent } from "@/types/check-in";
import type { PhaseStatus } from "@/types/roadmap";

type NutritionCalendarDayCellProps = {
  date: string;
  dayOfMonth: number;
  event: NutritionEvent | null;
  isToday: boolean;
  isPast: boolean;
  isOutsideMonth?: boolean;
  phaseStatus?: PhaseStatus | null;
  /** Activity-burn toggle — the cell shows the same total the rest of the builder does. */
  includeActivityBurn: boolean;
  /** Edit mode (◆2) — eligible cells become click-to-select targets. */
  editMode?: boolean;
  isSelected?: boolean;
  onToggle?: (date: string) => void;
};

/** Mirrors the training calendar's phase tint (calendar-day-cell.tsx). */
function phaseTintClass(status: PhaseStatus | null | undefined): string {
  switch (status) {
    case "active":
      return "bg-[rgba(13,148,136,0.06)]";
    case "completed":
      return "bg-[rgba(148,163,184,0.08)]";
    case "planned":
      return "bg-[rgba(59,130,246,0.06)]";
    default:
      return "";
  }
}

export const NutritionCalendarDayCell = memo(function NutritionCalendarDayCell({
  date,
  dayOfMonth,
  event,
  isToday,
  isPast,
  isOutsideMonth,
  phaseStatus,
  includeActivityBurn,
  editMode,
  isSelected,
  onToggle,
}: NutritionCalendarDayCellProps) {
  const target = event ? mapNutritionEventToDisplayTarget(event, includeActivityBurn) : null;
  // Eligible to edit = today-forward + a scheduled event (mirrors the server guard).
  const isEligible =
    !!editMode && !isPast && !!event && event.status === "scheduled";

  return (
    <div
      data-date={date}
      onClick={isEligible && onToggle ? () => onToggle(date) : undefined}
      className={cn(
        "min-h-[92px] rounded-[4px] border border-[rgba(13,148,136,0.06)] p-1.5 flex flex-col gap-1 relative transition-all",
        phaseTintClass(phaseStatus),
        isOutsideMonth && "opacity-40",
        isPast && !isOutsideMonth && "opacity-60",
        isToday && !isSelected && "ring-2 ring-teal-500",
        isEligible && "cursor-pointer hover:border-[rgba(13,148,136,0.3)]",
        isSelected && "ring-2 ring-teal-500/60 bg-[rgba(13,148,136,0.05)]"
      )}
    >
      {/* Header row: TRAIN badge (left) + date number (right) */}
      <div className="flex items-center justify-between leading-none">
        {event?.isTrainingDay ? (
          <span className="inline-flex items-center px-1 py-0.5 rounded-[3px] text-[8px] font-semibold bg-[#0d9488] text-white uppercase">
            Train
          </span>
        ) : (
          <span />
        )}
        <span
          className={cn(
            "text-[10px] font-medium",
            isToday ? "text-teal-600 font-semibold" : "text-[#93b0b4]"
          )}
        >
          {dayOfMonth}
        </span>
      </div>

      {target ? (
        <div className="flex flex-col gap-1 mt-auto">
          <div className="flex items-baseline gap-1">
            <span className="text-[15px] font-bold leading-none text-[#0c1a1e]">
              {target.calories.toLocaleString()}
            </span>
            <span className="text-[8px] text-[#93b0b4]">kcal</span>
            {event?.isModified && (
              <Pencil className="h-2.5 w-2.5 text-[#93b0b4] ml-auto flex-shrink-0" />
            )}
          </div>
          <div className="flex h-[4px] rounded-full overflow-hidden">
            <div className="bg-protein" style={{ width: `${target.proteinPercent}%` }} />
            <div className="bg-carbs" style={{ width: `${target.carbsPercent}%` }} />
            <div className="bg-fat" style={{ width: `${target.fatPercent}%` }} />
          </div>
          <p className="text-[9px] font-mono-display flex gap-1 leading-none">
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
