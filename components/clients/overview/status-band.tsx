"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { goalState } from "@/lib/goals/goal-state";
import { containsDigit } from "@/components/clients/metrics/metrics-format";
import { deadlineRemaining, formatDateOnlyShort } from "./overview-format";
import { InlineMono } from "./overview-primitives";
import { GoalHistoryPopover } from "./goal-history-popover";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { Client } from "@/types/check-in";
import { useUnits } from "@/contexts/units-context";
import { TextSkeleton } from "@/components/text-skeleton";
import { formatWeight } from "@/utils/unit-conversions";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";

/**
 * Where this client stands: the progression chart beside the four facts that
 * describe a destination rather than a period.
 *
 * Nothing in this band is windowed. The chart runs the client's whole journey
 * and the four cells are structural — goal targets, the energy pair and the
 * deadline describe a client rather than a period. The Signals card below is
 * the page's one trailing-window surface, and it names its own fortnight.
 *
 * The footer's lifetime delta keeps its `Since start:` prefix anyway: it is a
 * range figure sitting among four that are not, and the prefix is what tells
 * a reader which kind they are looking at.
 */
type StatusBandProps = {
  client: Client;
  /**
   * The goal driving this client now, resolved from `client_goals` by the tab.
   * Both targets come from here, never from the `clients` mirror on `client`.
   */
  goal: EffectiveGoal;
  /**
   * The progression chart, mounted by the tab so the band stays presentational
   * and the chart's own SWR read stays out of it.
   */
  chart: ReactNode;
  onOpenMetrics: () => void;
  /** The goal read is still in flight: the three goal-backed cells render
   *  pending instead of claiming "Not set" — unresolved is never rendered as
   *  empty (docs/newdesignsystem.md → "Loading & async states"). */
  goalPending?: boolean;
};

const DIVIDER = "border-[rgba(255,255,255,0.07)]";

type ChipTone = "positive" | "warning";

const GOAL_CHIP_TONE: Record<ChipTone, string> = {
  positive: "bg-[rgba(13,148,136,0.15)] text-[#0d9488]",
  warning: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
};

function formatDelta(current?: number, start?: number): string | null {
  if (current == null || start == null) return null;
  const delta = current - start;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`;
}

/**
 * Goal chip copy. `goalState` reports reached / beyond / gap; "under" vs "over"
 * needs the direction of travel, which only the caller's start value knows.
 */
function goalChip(
  start: number | undefined,
  current: number | undefined,
  goal: number | undefined,
  unit: string
): { text: string; tone: ChipTone } | null {
  const state = goalState({
    start: start ?? null,
    current: current ?? null,
    goal: goal ?? null,
  });
  if (!state) return null;

  if (state.state === "reached") return { text: "Goal reached", tone: "positive" };

  const amount = `${state.amount.toFixed(1)}${unit === "%" ? "%" : ` ${unit}`}`;
  if (state.state === "beyond") {
    const isLossGoal = start != null && goal != null && goal < start;
    return { text: `${amount} ${isLossGoal ? "under" : "over"} goal`, tone: "positive" };
  }
  return { text: `${amount} to go`, tone: "warning" };
}

/**
 * One value tier for the whole band: 18px mono semibold, StatStrip's number
 * tier (overview-primitives.tsx), so the dark band reads at the same scale as
 * the white cards rather than a size of its own.
 *
 * The deadline used to sit a tier below on the argument that a date the coach
 * typed is not a headline. It reads as an afterthought beside three 18px
 * figures, and it is one of the four facts this band exists to state — so it
 * matches them (owner call, 2026-08-28).
 *
 * `font-semibold` overrides STAT_VALUE_DARK_CLASS's `font-bold` (cn merges),
 * which was written for the 24-32px heroes.
 */
const VALUE_CLASS = "text-[18px] font-semibold";

function BandCell({
  label,
  value,
  unit,
  sub,
  subIsNumeric = true,
  chip,
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
  chip?: { text: string; tone: ChipTone } | null;
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
    <div className={cn("min-w-0 px-5 py-4", DIVIDER, borderClass)}>
      <p className={STAT_LABEL_DARK_CLASS}>{label}</p>
      <div className="mt-1">
        {pending ? (
          <span className={cn(STAT_VALUE_DARK_CLASS, VALUE_CLASS, "leading-tight")}>
            <TextSkeleton className="w-14" />
          </span>
        ) : value ? (
          <>
            <span className={cn(STAT_VALUE_DARK_CLASS, VALUE_CLASS, "leading-tight")}>
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
      {chip && !pending && (
        <span
          className={cn(
            // CHIP_NEUTRAL_CLASS's geometry (10px / px-1.5 / py-px), tinted.
            "mt-1 inline-block rounded-[4px] px-1.5 py-px text-[10px] font-medium",
            GOAL_CHIP_TONE[chip.tone],
            containsDigit(chip.text) && MONO
          )}
        >
          {chip.text}
        </span>
      )}
    </div>
  );
}

export function StatusBand({ client, goal, chart, onOpenMetrics, goalPending = false }: StatusBandProps) {
  // Body weights convert freely — formatWeight, never formatLoad.
  const { preference } = useUnits();
  const kg = (v: number | null | undefined) =>
    v == null ? undefined : formatWeight(v, preference).value;
  const weightUnit = formatWeight(0, preference).unit;

  const startWeight = kg(client.startingWeight);
  const currentWeight = kg(client.currentWeight);
  const goalWeight = kg(goal.goalWeightKg);
  const goalBodyFat = goal.goalBodyFatPercentage ?? undefined;

  const weightChip = goalChip(startWeight, currentWeight, goalWeight, weightUnit);
  const bfChip = goalChip(
    client.startingBodyFatPercentage,
    client.currentBodyFatPercentage,
    goalBodyFat,
    "%"
  );

  // Deltas between the DISPLAYED values, so the footer reconciles with the
  // numbers the sheet and the chart show.
  const weightDelta = formatDelta(currentWeight, startWeight);
  const bfDelta = formatDelta(client.currentBodyFatPercentage, client.startingBodyFatPercentage);
  const sinceStart = [
    weightDelta && `${weightDelta}${weightUnit}`,
    bfDelta && `${bfDelta}%`,
  ].filter(Boolean);

  const remaining = goal.deadline ? deadlineRemaining(goal.deadline, client.timezone) : null;
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
        <div className={cn("border-b lg:border-b-0 lg:border-r", DIVIDER)}>{chart}</div>

        <div className="grid grid-cols-2">
          <BandCell
            label="Goal weight"
            value={goalWeight?.toFixed(1)}
            unit={weightUnit}
            chip={weightChip}
            pending={goalPending}
          />
          <BandCell
            label="Goal body fat"
            value={goalBodyFat?.toFixed(1)}
            unit="%"
            chip={bfChip}
            borderClass="border-l"
            pending={goalPending}
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
            label="Deadline"
            value={goal.deadline ? formatDateOnlyShort(goal.deadline) : undefined}
            sub={remaining?.text}
            subIsNumeric={remaining?.isNumeric ?? false}
            borderClass="border-l border-t"
            pending={goalPending}
          />
        </div>
      </div>

      <div className={cn("flex items-center gap-4 border-t px-5 py-3", DIVIDER)}>
        {startsAhead && client.startDate ? (
          <span className="rounded-[4px] bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[10.5px] text-[rgba(255,255,255,0.55)]">
            Starts<InlineMono>{formatDateOnlyShort(client.startDate)}</InlineMono>
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
          <GoalHistoryPopover clientId={client.id} />
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
