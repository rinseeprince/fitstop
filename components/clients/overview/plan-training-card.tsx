"use client";

import { Dumbbell } from "lucide-react";
import { SPLIT_TYPE_LABELS } from "@/lib/training-constants";
import {
  CardHeader,
  EmptyInvite,
  NeutralChip,
  OpenTabLink,
  OverviewCard,
  StatStrip,
  type StatCellData,
} from "./overview-primitives";
import { formatDateOnlyWeekday, pluralize } from "./overview-format";
import type { OverviewPlanSummary } from "@/types/coach-overview";

type PlanTrainingCardProps = {
  training: OverviewPlanSummary["training"];
  onOpenTraining: () => void;
};

export function PlanTrainingCard({ training, onOpenTraining }: PlanTrainingCardProps) {
  if (!training) {
    return (
      <OverviewCard animationDelay="0.12s">
        <EmptyInvite
          icon={<Dumbbell className="h-8 w-8" strokeWidth={1.5} />}
          title="No training plan on the calendar"
          hint="Place a program so sessions land on this client's dates."
          actionLabel="Open Training"
          onAction={onOpenTraining}
        />
      </OverviewCard>
    );
  }

  const chips: string[] = [];
  if (training.splitType) {
    chips.push(SPLIT_TYPE_LABELS[training.splitType] ?? training.splitType);
  }
  if (training.frequencyPerWeek !== null) chips.push(`${training.frequencyPerWeek}x/week`);
  if (training.programDurationWeeks !== null) {
    chips.push(pluralize(training.programDurationWeeks, "week"));
  }

  const { completed, planned, missed } = training.thisWeek;

  const cells: StatCellData[] = [
    {
      label: "This week",
      value: `${completed} of ${planned}`,
      sub: missed > 0 ? `${pluralize(missed, "session")} missed` : "Nothing missed",
      subIsNumeric: missed > 0,
    },
    training.nextSession
      ? {
          label: "Next session",
          value: training.nextSession.name,
          valueIsName: true,
          sub: training.nextSession.isToday
            ? "Today · not logged"
            : formatDateOnlyWeekday(training.nextSession.date),
          subIsNumeric: !training.nextSession.isToday,
        }
      : { label: "Next session", value: null, sub: "Nothing scheduled ahead" },
    training.progressionPct !== null
      ? {
          label: "Progression",
          value: `${training.progressionPct > 0 ? "+" : ""}${training.progressionPct}%`,
          sub: "Best e1RM vs week 1",
        }
      : { label: "Progression", value: null, sub: "Not enough logged sets yet" },
  ];

  return (
    <OverviewCard animationDelay="0.12s">
      <CardHeader
        compact
        icon={<Dumbbell className="h-4 w-4" strokeWidth={1.5} />}
        title={training.planName}
        subtitle={
          chips.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {chips.map((chip) => (
                <NeutralChip key={chip}>{chip}</NeutralChip>
              ))}
            </div>
          ) : undefined
        }
        right={<OpenTabLink label="Open Training" onClick={onOpenTraining} />}
      />

      <div className="mt-auto border-t border-[rgba(13,148,136,0.06)]">
        <StatStrip cells={cells} />
      </div>
    </OverviewCard>
  );
}
