"use client";

import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateRange(start: Date, end: Date): string {
  const sameMonth =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `Week of ${MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    return `Week of ${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `Week of ${MONTHS[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

function formatSubmittedDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `Submitted ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

type CheckInReviewHeaderProps = {
  /** Clears `?checkIn=` through the tab handler. */
  onBack: () => void;
  /**
   * The week this check-in reports on. `null` while the detail loads, on a
   * foreign check-in, and before the window resolves — the same condition that
   * gated this line when it lived on the page.
   */
  meta: {
    start: Date;
    end: Date;
    submittedAt: string;
    /**
     * Days in the period with any log the client made themselves, over the
     * period's length — both from the server's own date lists, so the fraction
     * and the cells below it share one denominator. `null` on a legacy row
     * whose period cannot be resolved, and the chip is omitted.
     */
    daysLogged: { logged: number; inPeriod: number } | null;
    /**
     * Days since the previous check-in, `undefined` on a first one. Load-bearing
     * rather than decoration: every delta on this page reads "vs last check-in",
     * and the gap between two check-ins is whatever it is — 7 days or 92.
     */
    daysSinceLast?: number;
  } | null;
};

/**
 * The review's header: the back row in the sidebar grammar, over the week the
 * check-in reports on.
 */
export const CheckInReviewHeader = ({ onBack, meta }: CheckInReviewHeaderProps) => (
  <div className="min-w-0">
    {/* The sidebar back-row grammar: the arrow is the affordance, the label
        names the destination. */}
    <button
      type="button"
      onClick={onBack}
      aria-label="Back to check-ins"
      className="group flex items-center gap-2.5"
    >
      <ArrowLeft
        className="h-4 w-4 text-[#93b0b4] transition-colors group-hover:text-[#5a7d82]"
        strokeWidth={1.5}
      />
      <span className="text-[13.5px] font-semibold text-[#0c1a1e]">Check-ins</span>
    </button>
    {meta && (
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#93b0b4]">
        <span className={MONO}>{formatDateRange(meta.start, meta.end)}</span>
        <span>&middot;</span>
        <span className={MONO}>{formatSubmittedDate(meta.submittedAt)}</span>
        {meta.daysLogged && (
          <>
            <span>&middot;</span>
            <span
              className={cn(
                "inline-flex items-center text-xs font-semibold",
                MONO,
                "text-[#0d9488] bg-[rgba(13,148,136,0.08)] px-1.5 py-0.5 rounded-[4px]"
              )}
            >
              {meta.daysLogged.logged}/{meta.daysLogged.inPeriod} days logged
            </span>
          </>
        )}
        {meta.daysSinceLast !== undefined && (
          <>
            <span>&middot;</span>
            <span className={MONO}>{meta.daysSinceLast} days since last check-in</span>
          </>
        )}
      </p>
    )}
  </div>
);
