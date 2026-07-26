"use client";

import { CalendarClock, Dumbbell } from "lucide-react";
import { SPLIT_TYPE_LABELS } from "@/lib/training-constants";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
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
  upcomingTraining: OverviewPlanSummary["upcomingTraining"];
  onOpenTraining: () => void;
};

/** Split / frequency / duration chips — shared by the running and queued states. */
function planChips(plan: {
  splitType: string | null;
  frequencyPerWeek: number | null;
  programDurationWeeks: number | null;
}): string[] {
  const chips: string[] = [];
  if (plan.splitType) chips.push(SPLIT_TYPE_LABELS[plan.splitType] ?? plan.splitType);
  if (plan.frequencyPerWeek !== null) chips.push(`${plan.frequencyPerWeek}x/week`);
  if (plan.programDurationWeeks !== null) {
    chips.push(pluralize(plan.programDurationWeeks, "week"));
  }
  return chips;
}

function ChipRow({ chips }: { chips: string[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <NeutralChip key={chip}>{chip}</NeutralChip>
      ))}
    </div>
  );
}

export function PlanTrainingCard({
  training,
  upcomingTraining,
  onOpenTraining,
}: PlanTrainingCardProps) {
  // A program placed to start later is assigned, not absent. Saying "no plan"
  // here would invite the coach to place a second one alongside it.
  if (!training && upcomingTraining) {
    return (
      <OverviewCard animationDelay="0.12s">
        <CardHeader
          compact
          icon={<CalendarClock className="h-4 w-4" strokeWidth={1.5} />}
          title={upcomingTraining.planName}
          subtitle={<ChipRow chips={planChips(upcomingTraining)} />}
          right={<OpenTabLink label="Open Training" onClick={onOpenTraining} />}
        />
        <div className="mt-auto border-t border-[rgba(13,148,136,0.06)] px-5 py-4">
          <p className="text-[13px] font-semibold text-[#0c1a1e]">
            Starts <span className={MONO}>{formatDateOnlyWeekday(upcomingTraining.startsOn)}</span>
          </p>
          <p className="mt-1 text-[11px] text-[#93b0b4]">
            Sessions, adherence and progression begin on day one.
          </p>
        </div>
      </OverviewCard>
    );
  }

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

  const chips = planChips(training);
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
        subtitle={<ChipRow chips={chips} />}
        right={<OpenTabLink label="Open Training" onClick={onOpenTraining} />}
      />

      <div className="mt-auto border-t border-[rgba(13,148,136,0.06)]">
        <StatStrip cells={cells} />
      </div>
    </OverviewCard>
  );
}
