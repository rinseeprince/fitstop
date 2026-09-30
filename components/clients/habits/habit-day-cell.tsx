"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import type { HabitCellState } from "./habit-cell-state";

type HabitDayCellProps = {
  state: HabitCellState;
  /** A number habit's entry that day, shown in place of the tick, the cross or today's pulse. */
  value: number | null;
};

/** A number short enough for a 28px cell: 6,000 reads 6.0k. */
function compactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function HabitDayCell({ state, value }: HabitDayCellProps) {
  if (state === "blank") {
    return <div data-state={state} className="w-[28px] h-[28px] mx-auto" />;
  }

  if (state === "done") {
    return (
      <div data-state={state} className="w-[28px] h-[28px] mx-auto rounded-[4px] bg-[#0d9488] flex items-center justify-center">
        {value != null ? (
          <span className={cn(MONO, "text-[9px] font-bold text-white leading-none")}>{compactNumber(value)}</span>
        ) : (
          <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        )}
      </div>
    );
  }

  if (state === "missed") {
    // A number short of its target keeps its number: the coach reads how short.
    return (
      <div data-state={state} className="w-[28px] h-[28px] mx-auto rounded-[4px] border border-dashed border-[rgba(13,148,136,0.2)] flex items-center justify-center">
        {value != null ? (
          <span className={cn(MONO, "text-[9px] font-bold text-[#93b0b4] leading-none")}>{compactNumber(value)}</span>
        ) : (
          <X className="w-3 h-3 text-[#93b0b4]" strokeWidth={2} />
        )}
      </div>
    );
  }

  // pending (today, still open): a number entered so far shows in the box —
  // the coach reads how far along — else the pulse.
  return (
    <div data-state={state} className="w-[28px] h-[28px] mx-auto rounded-[4px] border border-[rgba(13,148,136,0.25)] flex items-center justify-center relative">
      {value != null ? (
        <span className={cn(MONO, "text-[9px] font-bold text-[#0d9488] leading-none")}>{compactNumber(value)}</span>
      ) : (
        <span className={cn("w-[6px] h-[6px] rounded-full bg-[#0d9488]", "animate-pulse")} />
      )}
    </div>
  );
}
