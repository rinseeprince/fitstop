"use client";

import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MONO,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { ExercisePR } from "@/types/training";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";

// The `weightUnit` prop is gone. It defaulted to "kg" and the coach caller
// (exercise-data-view.tsx) never passed it, so every PR rendered as kilograms
// regardless of who was looking; the client-portal caller passed the same
// constant down from a mapper shim. Both now read the viewer's own preference.
type ExercisePrViewProps = {
  data: ExercisePR[] | undefined;
  isLoading: boolean;
};

export function ExercisePrView({ data, isLoading }: ExercisePrViewProps) {
  const { preference } = useUnits();
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-[10px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[80px] rounded-[6px]" />
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

  // Sort by recency (newest first)
  const sorted = [...data].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-[10px]">
      {sorted.map((pr) => (
        <div
          key={pr.reps}
          className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] px-[14px] py-[14px] relative"
        >
          {pr.isRecent && (
            <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold text-[#0d9488] bg-[rgba(13,148,136,0.08)] px-1.5 py-0.5 rounded-[3px]">
              New
            </span>
          )}
          <p className={cn(MONO_LABEL_CLASS, "leading-tight")}>
            {pr.reps === 1 ? "1 Rep Max" : `${pr.reps} Rep Max`}
          </p>
          <p className={cn(MONO, "text-[20px] font-semibold text-[#0c1a1e] mt-1 tabular-nums leading-tight")}>
            {formatLoad(pr.weight, preference).value}
            <span className="text-[12px] text-[#93b0b4] ml-1">
              {formatLoad(pr.weight, preference).unit}
            </span>
          </p>
          <p className={cn(MONO, "text-[11px] text-[#93b0b4] mt-1 leading-tight")}>
            {format(new Date(pr.date), "MMM d, yyyy")}
          </p>
        </div>
      ))}
    </div>
  );
}
