"use client";

import { CheckCircle2, CircleDashed, XCircle, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  CheckInExerciseHighlight,
  CheckInTrainingEventDetail,
} from "@/types/check-in";
import type { TrainingAdherenceStatus } from "@/lib/training-adherence";
import { trainingAdherenceStatus } from "@/lib/training-adherence";
import { cn } from "@/lib/utils";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  LABEL_CLASS,
  MONO,
} from "@/components/clients/training/program-builder/builder-tokens";

type TrainingSectionProps = {
  /** The period's workouts, in calendar order — the review read's own rows. */
  workouts: CheckInTrainingEventDetail[];
  highlights: CheckInExerciseHighlight[];
};

// The workout's day, from its own date. Parsed at local noon so the weekday is
// stable across a DST boundary.
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });

// Teal Summit two-colour status: teal full, amber partial, muted missed (no
// red). The three words a WORKOUT is described in — "completed" is reserved for
// counts, so this pill never says it under a ribbon reading "4 of 5 completed"
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md, §4.7 M8).
const STATUS_META: Record<TrainingAdherenceStatus, { label: string; icon: LucideIcon; pill: string }> = {
  full: { label: "Full", icon: CheckCircle2, pill: "bg-[rgba(13,148,136,0.08)] text-[#0d9488]" },
  partial: { label: "Partial", icon: CircleDashed, pill: "bg-[rgba(245,158,11,0.07)] text-[#d97706]" },
  missed: { label: "Missed", icon: XCircle, pill: "bg-[rgba(13,148,136,0.04)] text-[#93b0b4]" },
};

export const TrainingSection = ({ workouts, highlights }: TrainingSectionProps) => {
  const { preference } = useUnits();
  const prHighlights = highlights.filter((h) => h.highlightType === "pr");

  if (workouts.length === 0 && prHighlights.length === 0) return null;

  return (
    // A flex ITEM, not a grid cell: the page puts this beside its sibling, and
    // either section can return null on an empty week. A null child emits no
    // node, so the survivor takes the full row without the page having to know
    // which one rendered. `min-w-0` stops the mono numerals setting the basis.
    <div className="flex min-w-0 flex-1 flex-col">
      {/* No count on the rail: the KPI ribbon above states the week's
          completed-over-prescribed figure once (owner, 2026-09-04). */}
      <SectionLabel label="Training" />
      <div className="flex-1 rounded-[6px] bg-white p-5">
        {workouts.length > 0 && (
          <div className="flex flex-col gap-2">
            {workouts.map((workout) => {
              // The pill reads the quality off the workout's LOG, through the
              // same classifier the count above it is summed from.
              const meta = STATUS_META[trainingAdherenceStatus(workout)];
              const Icon = meta.icon;
              return (
                <div
                  key={workout.eventId}
                  className="flex items-center gap-3 px-3 py-2.5 bg-[rgba(13,148,136,0.03)] rounded-[6px]"
                >
                  <span className={cn(LABEL_CLASS, "w-8 shrink-0")}>
                    {dayLabel(workout.date)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate text-[#0c1a1e]">
                      {workout.performedSessionName ?? workout.sessionName}
                    </div>
                    {workout.notes && (
                      <div className="text-xs text-[#93b0b4] italic truncate">
                        &ldquo;{workout.notes}&rdquo;
                      </div>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${meta.pill}`}
                  >
                    <Icon className="w-3 h-3" />
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* PR highlight strip - structured exercise PRs flagged this week */}
        {prHighlights.length > 0 && (
          <div className="mt-3 p-3 bg-[rgba(13,148,136,0.05)] border-l-[3px] border-l-[#0d9488] rounded-[6px] flex items-center gap-2.5">
            <Trophy className="w-5 h-5 text-[#0d9488] shrink-0" strokeWidth={1.5} />
            <div className="text-[13px] font-medium text-[#0c1a1e]">
              {prHighlights.map((pr, i) => (
                <span key={pr.id ?? i}>
                  {pr.exerciseName}
                  {(pr.weightValue || pr.reps) && (
                    <span className={cn("font-bold", MONO, "text-[#0d9488]")}>
                      {" "}
                      {/* A PR is a barbell load, so formatLoad — it snaps an
                          imperial conversion to something loadable. */}
                      {pr.weightValue &&
                        `${formatLoad(pr.weightValue, preference).value}${formatLoad(pr.weightValue, preference).unit}`}
                      {pr.weightValue && pr.reps && " x "}
                      {pr.reps && `${pr.reps} reps`}
                    </span>
                  )}
                  {pr.details && ` - ${pr.details}`}
                  {i < prHighlights.length - 1 && " | "}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
