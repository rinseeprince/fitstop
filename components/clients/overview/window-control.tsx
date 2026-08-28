"use client";

import { cn } from "@/lib/utils";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { OVERVIEW_WINDOWS, type OverviewWindow } from "@/lib/overview/window";

/**
 * The Overview's one window selector, mounted in the Progression rail's
 * `actions` slot.
 *
 * **Not `<SegmentedControl>`, deliberately.** The design system sends every
 * pane/period switcher to that component, but the shipped precedent for this
 * exact control in this exact position is the Metrics page's range picker
 * (`metric-progression-section.tsx`) — a rail-mounted option row, not a pill
 * track. A segmented track on a divider rail sits taller than the 24.5px the
 * rail pins and pushes the hairline off every other surface's line.
 *
 * The labels are numerals but stay SANS: the design SOT's own tie-break says
 * interactive control options are controls, not data strings.
 */
export function WindowControl({
  value,
  onChange,
}: {
  value: OverviewWindow;
  onChange: (days: OverviewWindow) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {OVERVIEW_WINDOWS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={value === days}
          aria-label={`Last ${days} days`}
          onClick={() => onChange(days)}
          className={cn(
            LABEL_CLASS,
            "rounded-[6px] px-2 py-1 text-[11px] transition-colors",
            value === days
              ? "bg-[rgba(13,148,136,0.08)] font-semibold text-[#0d9488]"
              : "hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0d9488]"
          )}
        >
          {days}
        </button>
      ))}
    </div>
  );
}
