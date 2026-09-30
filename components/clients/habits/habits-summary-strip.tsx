"use client";

import { cn } from "@/lib/utils";
import { TextSkeleton } from "@/components/text-skeleton";
import {
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";

type HabitsSummaryStripProps = {
  /** The week read is still in flight: Today and Weekly Rate render as pending
   *  text inside the real elements — a dash is a settled answer, not a
   *  loading state. */
  weekPending: boolean;
  /** The habit list is still in flight: Active Habits is pending. */
  listPending: boolean;
  /** Today's planned habits done today, "1/2"; null when today is not in the week shown or nothing is planned today. */
  today: string | null;
  /** The week's met of its planned, "6/14"; null when nothing was planned. */
  weeklyRate: string | null;
  /** The habits running on the client's today. */
  activeCount: number | null;
};

function StatColumn({
  label,
  value,
  sub,
  isLast,
  pending,
}: {
  label: string;
  value: string;
  sub?: string;
  isLast?: boolean;
  /** Value renders as pending text inside the real element; the static sub
   *  copy stays — it describes the slot, not the data. */
  pending?: boolean;
}) {
  return (
    <div
      className={
        isLast
          ? "flex flex-col pl-5"
          : "flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.07)]"
      }
    >
      <p className={STAT_LABEL_DARK_CLASS}>
        {label}
      </p>
      <p className={cn(STAT_VALUE_DARK_CLASS, "text-[28px] leading-tight mt-1")}>
        {pending ? <TextSkeleton className="w-12" /> : value}
      </p>
      {sub && (
        <p className="text-[11px] text-[rgba(255,255,255,0.3)] mt-1">
          {sub}
        </p>
      )}
    </div>
  );
}

export function HabitsSummaryStrip({
  weekPending,
  listPending,
  today,
  weeklyRate,
  activeCount,
}: HabitsSummaryStripProps) {
  return (
    <div className="bg-[#0f2027] rounded-[6px] p-5 grid grid-cols-3">
      <StatColumn label="Today" value={today ?? "—"} sub="completed" pending={weekPending} />
      <StatColumn label="Weekly Rate" value={weeklyRate ?? "—"} sub="this week" pending={weekPending} />
      <StatColumn
        label="Active Habits"
        value={activeCount === null ? "—" : String(activeCount)}
        sub="tracked"
        isLast
        pending={listPending}
      />
    </div>
  );
}
