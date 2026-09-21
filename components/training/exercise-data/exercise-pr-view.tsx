"use client";

import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LABEL_CLASS,
  MONO,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { ExercisePR } from "@/types/training";
import type { ExerciseType } from "@/utils/exercise-types";
import {
  BEST_KIND_LABELS,
  PR_EMPTY_HINTS,
  orderedBestKinds,
  type BestKind,
} from "@/utils/exercise-progress-markers";
import { useUnits } from "@/contexts/units-context";
import { dayFromUtcStamp } from "@/lib/date-helpers";
import {
  formatDistance,
  formatDuration,
  formatLoad,
  type UnitSystem,
} from "@/utils/unit-conversions";

// An exercise's PRs are its bests of every kind the logs carry: rep maxes for
// a lift, the best bodyweight set, the fastest time per distance, the heaviest
// carry per distance, the longest hold (utils/exercise-progress-markers.ts).
// Its type's own kinds come first. One kind renders as the plain grid it always
// was; more than one puts a heading over each.
//
// The viewer's own unit preference: every load reads through formatLoad, which
// snaps an imperial conversion to a loadable increment.
type ExercisePrViewProps = {
  data: ExercisePR[] | undefined;
  exerciseType: ExerciseType;
  isLoading: boolean;
};

/** One card's words: its label, and the number with the unit that sits beside it. */
function describePr(
  pr: ExercisePR,
  viewer: UnitSystem,
): { label: string; numericLabel: boolean; value: string; unit: string } {
  switch (pr.kind) {
    case "rep_max": {
      const load = formatLoad(pr.weight, viewer);
      return {
        label: pr.reps === 1 ? "1 Rep Max" : `${pr.reps} Rep Max`,
        numericLabel: true,
        value: String(load.value),
        unit: load.unit,
      };
    }
    case "best_reps":
      return { label: "Best set", numericLabel: false, value: String(pr.reps), unit: "reps" };
    case "best_time":
      return {
        label: formatDistance(pr.distanceMeters, viewer),
        numericLabel: true,
        value: formatDuration(pr.durationSeconds),
        unit: "",
      };
    case "heaviest_carry": {
      const load = formatLoad(pr.weight, viewer);
      return {
        label: `${formatDistance(pr.distanceMeters, viewer)} carry`,
        numericLabel: true,
        value: String(load.value),
        unit: load.unit,
      };
    }
    case "longest_hold":
      return {
        label: "Longest hold",
        numericLabel: false,
        value: formatDuration(pr.durationSeconds),
        unit: "",
      };
  }
}

function prKey(pr: ExercisePR): string {
  switch (pr.kind) {
    case "rep_max":
      return `rep_max:${pr.reps}`;
    case "best_time":
      return `best_time:${pr.distanceMeters}`;
    case "heaviest_carry":
      return `heaviest_carry:${pr.distanceMeters}`;
    default:
      return pr.kind;
  }
}

const GRID_CLASS = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-[10px]";

export function ExercisePrView({ data, exerciseType, isLoading }: ExercisePrViewProps) {
  const { preference } = useUnits();
  if (isLoading) {
    return (
      <div className={GRID_CLASS}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[80px] rounded-[6px]" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="text-center text-[13px] text-[#93b0b4] py-12">
        No personal records yet. {PR_EMPTY_HINTS[exerciseType]}
      </p>
    );
  }

  const byKind = new Map<BestKind, ExercisePR[]>();
  for (const pr of data) {
    byKind.set(pr.kind, [...(byKind.get(pr.kind) ?? []), pr]);
  }
  const kinds = orderedBestKinds(exerciseType, new Set(byKind.keys()));
  const withHeadings = kinds.length > 1;

  return (
    <div className="space-y-4">
      {kinds.map((kind) => {
        // Newest first within a kind
        const records = [...(byKind.get(kind) ?? [])].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
        return (
          <section key={kind} aria-label={BEST_KIND_LABELS[kind]}>
            {withHeadings && (
              <p className={cn(LABEL_CLASS, "mb-2")}>{BEST_KIND_LABELS[kind]}</p>
            )}
            <div className={GRID_CLASS}>
              {records.map((pr) => {
                const words = describePr(pr, preference);
                return (
                  <div
                    key={prKey(pr)}
                    className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] px-[14px] py-[14px] relative"
                  >
                    {pr.isRecent && (
                      <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold text-[#0d9488] bg-[rgba(13,148,136,0.08)] px-1.5 py-0.5 rounded-[3px]">
                        New
                      </span>
                    )}
                    <p className={cn(words.numericLabel ? MONO_LABEL_CLASS : LABEL_CLASS, "leading-tight")}>
                      {words.label}
                    </p>
                    <p className={cn(MONO, "text-[20px] font-semibold text-[#0c1a1e] mt-1 tabular-nums leading-tight")}>
                      {words.value}
                      {words.unit && (
                        <span className="text-[12px] text-[#93b0b4] ml-1">{words.unit}</span>
                      )}
                    </p>
                    <p className={cn(MONO, "text-[11px] text-[#93b0b4] mt-1 leading-tight")}>
                      {format(dayFromUtcStamp(pr.date), "MMM d, yyyy")}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
