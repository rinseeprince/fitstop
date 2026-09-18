"use client";

import { Dumbbell } from "lucide-react";
import { SPLIT_TYPE_LABELS } from "@/lib/training-constants";
import {
  CardHeader,
  EmptyInvite,
  InlineMono,
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
  //
  // The queued layout is shared with the nutrition card beside it (owner,
  // 2026-09-09): a generic title carrying the identity chips, a header
  // hairline, a one-cell body naming what is queued, and the Starts footer
  // under its own hairline — so the two cards line up whichever is queued.
  if (!training && upcomingTraining) {
    return (
      <OverviewCard animationDelay="0.12s">
        <CardHeader
          compact
          icon={<Dumbbell className="h-4 w-4" strokeWidth={1.5} />}
          title="Training plan"
          subtitle={<ChipRow chips={planChips(upcomingTraining)} />}
          right={<OpenTabLink label="Open Training" onClick={onOpenTraining} />}
        />
        {/* The body sits under a FIXED header hairline and the footer is what
            pins to the bottom — a shorter body must not drag its hairline
            down, or the two cards' header lines drift apart. */}
        <div className="border-t border-[rgba(13,148,136,0.06)]">
          <StatStrip
            cells={[{ label: "Program", value: upcomingTraining.planName, valueIsName: true }]}
          />
        </div>
        <div className="mt-auto border-t border-[rgba(13,148,136,0.06)] px-5 py-4">
          <p className="text-[13px] font-semibold text-[#0c1a1e]">
            {/* No space before InlineMono — it owns its own gap. */}
            Starts<InlineMono>{formatDateOnlyWeekday(upcomingTraining.startsOn)}</InlineMono>
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
      // "Logged", because that is what the figure counts: every workout the
      // client logged this week, full or partial, over the week's workouts
      // (`getTrainingWeekSummary` — the same run the Training-tab hero
      // renders, so the two cannot disagree). Today's session is in neither
      // side until they log it.
      //
      // The WINDOW is deliberately left as "this week" rather than a pair of
      // weekdays: `getTrainingWeekStart` anchors the week on the client's own
      // check-in day, so no fixed Mon–Sun claim is true for every client, and
      // the plan summary does not carry its window on the wire to print.
      label: "Logged this week",
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
