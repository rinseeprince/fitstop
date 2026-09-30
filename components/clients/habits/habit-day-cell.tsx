"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import type { HabitCellState } from "./habit-cell-state";

type HabitDayCellProps = {
  state: HabitCellState;
  /** A number habit's entry that day, shown in place of the tick, the cross or today's pulse. */
  value: number | null;
  /** The coach changed this one day ("This day"): a dot on the cell's corner says so. */
  edited: boolean;
};

/** A number short enough for a 28px cell: 6,000 reads 6.0k. */
function compactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

const BOX = "relative mx-auto flex h-[28px] w-[28px] items-center justify-center rounded-[4px]";

export function HabitDayCell({ state, value, edited }: HabitDayCellProps) {
  const mark = edited ? (
    <span data-edited className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-[#0d9488] ring-2 ring-white" />
  ) : null;

  if (state === "blank") {
    return (
      <div data-state={state} className={BOX}>
        {mark}
      </div>
    );
  }

  if (state === "done") {
    return (
      <div data-state={state} className={cn(BOX, "bg-[#0d9488]")}>
        {value != null ? (
          <span className={cn(MONO, "text-[9px] font-bold text-white leading-none")}>{compactNumber(value)}</span>
        ) : (
          <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        )}
        {mark}
      </div>
    );
  }

  if (state === "missed") {
    // A number short of its target keeps its number: the coach reads how short.
    return (
      <div data-state={state} className={cn(BOX, "border border-dashed border-[rgba(13,148,136,0.2)]")}>
        {value != null ? (
          <span className={cn(MONO, "text-[9px] font-bold text-[#93b0b4] leading-none")}>{compactNumber(value)}</span>
        ) : (
          <X className="w-3 h-3 text-[#93b0b4]" strokeWidth={2} />
        )}
        {mark}
      </div>
    );
  }

  if (state === "ahead") {
    // Planned, still to come: an empty box, quieter than today's.
    return (
      <div data-state={state} className={cn(BOX, "border border-[rgba(13,148,136,0.15)]")}>
        {mark}
      </div>
    );
  }

  // pending (today, still open): a number entered so far shows in the box —
  // the coach reads how far along — else the pulse.
  return (
    <div data-state={state} className={cn(BOX, "border border-[rgba(13,148,136,0.25)]")}>
      {value != null ? (
        <span className={cn(MONO, "text-[9px] font-bold text-[#0d9488] leading-none")}>{compactNumber(value)}</span>
      ) : (
        <span className={cn("w-[6px] h-[6px] rounded-full bg-[#0d9488]", "animate-pulse")} />
      )}
      {mark}
    </div>
  );
}
