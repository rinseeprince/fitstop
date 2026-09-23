"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GOAL_TYPE_SETTINGS } from "@/lib/goals/goal-types";
import { deadlineRemaining, formatDateOnlyShort } from "./overview-format";
import { InlineMono } from "./overview-primitives";
import { BAND_DIVIDER, BAND_VALUE_CLASS, GoalCell, TargetCell } from "./goal-cells";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { Client } from "@/types/check-in";
import type { CurrentGoal, GoalOnDay } from "@/types/client-goals";
import type { MeasurementSeries } from "@/types/coach-overview";
import { useUnits } from "@/contexts/units-context";
import { TextSkeleton } from "@/components/text-skeleton";
import { formatWeight } from "@/utils/unit-conversions";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";

/**
 * Where this client stands: the progression chart beside the four facts that
 * describe a destination rather than a period — the goal card (the goal, its
 * targets and its deadline) and the energy pair.
 *
 * Nothing in this band is windowed. The chart runs the client's whole journey
 * and the four cells are structural — they describe a client rather than a
 * period.
 *
 * The footer's lifetime delta keeps its `Since start:` prefix anyway: it is a
 * range figure sitting among four that are not, and the prefix is what tells
 * a reader which kind they are looking at.
 */
type StatusBandProps = {
  client: Client;
  /**
   * The goal in force on the client's today, as stored, with the client's
   * readings on its start day — which its chips measure from, in the direction
   * its type sets. null = no goal in force.
   */
  goal: CurrentGoal | null;
  /** The goal planned next, soonest first; null = none planned. */
  nextGoal: GoalOnDay | null;
  /** Opens the goals sheet. */
  onEditGoals: () => void;
  /**
   * The progression chart, mounted by the tab so the band stays presentational
   * and the chart's own SWR read stays out of it.
   */
  chart: ReactNode;
  /**
   * The measurement journey the tab fetched for the chart. The "now" of every
   * figure — the goal chips and the Since-start pill — and the pill's start
   * (the baseline, the client's origin) come from HERE, never from the
   * page-level client record: the record revalidates only on coach-side
   * writes, so a check-in the client submits reached the chart on the next
   * visit and the pill only on a full reload.
   */
  series: MeasurementSeries | null;
  onOpenMetrics: () => void;
  /** Goal history: the Journey's goals table. */
  onOpenGoalHistory: () => void;
  /** The goal read is still in flight: the three goal cells render pending
   *  instead of claiming "Not set" — unresolved is never rendered as empty
   *  (docs/newdesignsystem.md → "Loading & async states"). */
  goalPending?: boolean;
  /** The goal read failed: the goal cells say so rather than "Not set". */
  goalFailed?: boolean;
  /** The series read is still in flight: the chips and the pill render pending. */
  seriesPending?: boolean;
};

/** "Now": the newest reading of ANY date — the series is ascending by day. */
function newestOf(series: MeasurementSeries | null, key: "weight" | "bodyFat"): number | undefined {
  const points = series?.[key];
  return points && points.length > 0 ? points[points.length - 1].value : undefined;
}

/** The baseline: the reading as of the start date, derived by the database. */
function baselineOf(series: MeasurementSeries | null, key: "weight" | "bodyFat"): number | undefined {
  return series?.baseline?.[key]?.value;
}

function formatDelta(current?: number, start?: number): string | null {
  if (current == null || start == null) return null;
  const delta = current - start;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`;
}

/**
 * One value tier for the whole band: 18px mono semibold, StatStrip's number
 * tier (overview-primitives.tsx), so the dark band reads at the same scale as
 * the white cards rather than a size of its own. The deadline matches the
 * figures: it is one of the facts this band exists to state (owner call,
 * 2026-08-28). `font-semibold` overrides STAT_VALUE_DARK_CLASS's `font-bold`
 * (cn merges), which was written for the 24-32px heroes.
 */
function BandCell({
  label,
  value,
  unit,
  sub,
  subIsNumeric = true,
  borderClass,
  emptyLabel = "Not set",
  pending = false,
}: {
  label: string;
  value?: string;
  unit?: string;
  sub?: string;
  /** Word-only sub-lines stay sans, the divider grammar's rule for metas. */
  subIsNumeric?: boolean;
  /**
   * Which edges this cell draws, spelled per cell rather than derived from an
   * index: the band reflows from four columns to two, so "has a cell to my
   * left" is a different answer at each breakpoint and a boolean cannot carry
   * both. A left hairline on a cell that starts a row draws against the band's
   * own edge.
   */
  borderClass?: string;
  emptyLabel?: string;
  /** Renders the value slot as pending text inside the real element. */
  pending?: boolean;
}) {
  return (
    <div className={cn("min-w-0 px-5 py-4", BAND_DIVIDER, borderClass)}>
      <p className={STAT_LABEL_DARK_CLASS}>{label}</p>
      <div className="mt-1">
        {pending ? (
          <span className={cn(STAT_VALUE_DARK_CLASS, BAND_VALUE_CLASS, "leading-tight")}>
            <TextSkeleton className="w-14" />
          </span>
        ) : value ? (
          <>
            <span className={cn(STAT_VALUE_DARK_CLASS, BAND_VALUE_CLASS, "leading-tight")}>
              {value}
            </span>
            {unit && (
              <span className="ml-1 text-[11px] font-normal text-[rgba(255,255,255,0.30)]">
                {unit}
              </span>
            )}
          </>
        ) : (
          <span className="text-[13px] text-[rgba(255,255,255,0.3)]">{emptyLabel}</span>
        )}
      </div>
      {sub && !pending && (
        <p
          className={cn(
            "mt-1 truncate text-[11px] text-[rgba(255,255,255,0.3)]",
            subIsNumeric && MONO
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

export function StatusBand({
  client,
  goal,
  nextGoal,
  onEditGoals,
  chart,
  series,
  onOpenMetrics,
  onOpenGoalHistory,
  goalPending = false,
  goalFailed = false,
  seriesPending = false,
}: StatusBandProps) {
  // Body weights convert freely — formatWeight, never formatLoad.
  const { preference } = useUnits();
  const kg = (v: number | null | undefined) =>
    v == null ? undefined : formatWeight(v, preference).value;
  const weightUnit = formatWeight(0, preference).unit;

  const baselineWeight = kg(baselineOf(series, "weight"));
  const currentWeight = kg(newestOf(series, "weight"));
  const baselineBodyFat = baselineOf(series, "bodyFat");
  const currentBodyFat = newestOf(series, "bodyFat");

  // Deltas between the DISPLAYED values, so the footer reconciles with the
  // numbers the chart shows.
  const weightDelta = formatDelta(currentWeight, baselineWeight);
  const bfDelta = formatDelta(currentBodyFat, baselineBodyFat);
  const sinceStart = [
    weightDelta && `${weightDelta}${weightUnit}`,
    bfDelta && `${bfDelta}%`,
  ].filter(Boolean);

  const deadline = goal?.deadline ?? null;
  const remaining = deadline ? deadlineRemaining(deadline, client.timezone) : null;
  // Every "since start" figure waits for the start date; the big numbers above
  // do not (they are "now", the newest reading of any date).
  const startsAhead =
    client.startDate != null &&
    client.startDate > getTodayDateStringInTimezone(client.timezone);

  return (
    <div
      className="flex flex-col rounded-[6px] bg-[#0f2027] animate-card-in"
      style={{ animationDelay: "0.06s" }}
    >
      {/* Chart | cells. The chart is the one WINDOWED thing in the band and it
          is deliberately walled off from the four cells beside it, which are
          structural; the divider between them is the boundary the Progression
          rail's control does and does not reach. */}
      <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className={cn("border-b lg:border-b-0 lg:border-r", BAND_DIVIDER)}>{chart}</div>

        <div className="grid grid-cols-2">
          <GoalCell
            goal={goal}
            nextGoal={nextGoal}
            pending={goalPending}
            failed={goalFailed}
            onEditGoals={onEditGoals}
          />
          {/* The chips need both reads; the goal and deadline cells only the goal. */}
          <TargetCell
            goal={goal}
            currentWeight={currentWeight}
            currentBodyFat={currentBodyFat}
            toDisplayWeight={kg}
            weightUnit={weightUnit}
            pending={goalPending || seriesPending}
            failed={goalFailed}
            borderClass="border-l"
          />
          <BandCell
            label="BMR"
            value={client.bmr ? Math.round(client.bmr).toString() : undefined}
            unit="cal/day"
            emptyLabel="Not recorded"
            sub={client.tdee ? `TDEE ${Math.round(client.tdee)}` : undefined}
            borderClass="border-t"
          />
          <BandCell
            label={goal ? GOAL_TYPE_SETTINGS[goal.type].deadlineLabel : "Deadline"}
            value={deadline ? formatDateOnlyShort(deadline) : undefined}
            sub={remaining?.text}
            subIsNumeric={remaining?.isNumeric ?? false}
            borderClass="border-l border-t"
            emptyLabel={goalFailed ? "—" : "Not set"}
            pending={goalPending}
          />
        </div>
      </div>

      <div className={cn("flex items-center gap-4 border-t px-5 py-3", BAND_DIVIDER)}>
        {startsAhead && client.startDate ? (
          <span className="rounded-[4px] bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[10.5px] text-[rgba(255,255,255,0.55)]">
            Starts<InlineMono>{formatDateOnlyShort(client.startDate)}</InlineMono>
          </span>
        ) : seriesPending ? (
          // Unresolved is never rendered as empty: the pill's frame stands
          // while the series lands, so nothing shifts when it does.
          <span className="rounded-[4px] bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[10.5px] text-[rgba(255,255,255,0.55)]">
            Since start:<InlineMono><TextSkeleton className="w-20" /></InlineMono>
          </span>
        ) : sinceStart.length > 0 && (
          // "Since start:" is load-bearing, not decoration: this is a range
          // figure sitting among four that describe a destination, and the
          // prefix is what tells a reader which kind they are looking at.
          <span className="rounded-[4px] bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[10.5px] text-[rgba(255,255,255,0.55)]">
            {/* No space before InlineMono — it owns its own gap. */}
            Since start:<InlineMono>{sinceStart.join(" · ")}</InlineMono>
          </span>
        )}
        <div className="ml-auto flex items-center gap-4">
          <button
            type="button"
            onClick={onOpenGoalHistory}
            className="text-[11px] font-medium text-[#93b0b4] transition-colors hover:text-white"
          >
            Goal history
          </button>
          <button
            type="button"
            onClick={onOpenMetrics}
            className="text-[11px] font-medium text-[#0d9488] transition-colors hover:text-white"
          >
            Open metrics →
          </button>
        </div>
      </div>
    </div>
  );
}
