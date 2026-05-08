"use client";

import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExercisePR } from "@/types/training";

type ExercisePrViewProps = {
  data: ExercisePR[] | undefined;
  isLoading: boolean;
};

export function ExercisePrView({ data, isLoading }: ExercisePrViewProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[100px] rounded-[6px]" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="text-center text-[13px] text-[#93b0b4] py-12">
        No personal records yet. Log sets with weight to start tracking PRs.
      </p>
    );
  }

  const sorted = [...data].sort((a, b) => a.reps - b.reps);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {sorted.map((pr) => (
        <div
          key={pr.reps}
          className="border border-[rgba(13,148,136,0.08)] rounded-[6px] p-4 relative"
        >
          {pr.isRecent && (
            <span className="absolute top-2 right-2 text-[10px] font-semibold text-[#0d9488] bg-[rgba(13,148,136,0.08)] px-1.5 py-0.5 rounded-[3px]">
              New
            </span>
          )}
          <p className="text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">
            {pr.reps === 1 ? "1 Rep Max" : `${pr.reps} Rep Max`}
          </p>
          <p className="text-[24px] font-bold text-[#0c1a1e] mt-1 font-mono-display tabular-nums">
            {pr.weight}
          </p>
          <p className="text-[11px] text-[#93b0b4] mt-1">
            {format(new Date(pr.date), "MMM d, yyyy")}
          </p>
        </div>
      ))}
    </div>
  );
}
