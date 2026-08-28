"use client";

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
import { formatWeight } from "@/utils/unit-conversions";

/**
 * Where this client stands: the four facts that describe a destination rather
 * than a period, on the dark surface, under the Progression rail.
 *
 * The window control on that rail governs the chart (commit 6) and the Signals
 * card — **not these cells**. Goal targets, the energy pair and the deadline
 * are structural: they describe a client, not a fortnight, and re-cutting them
 * by a window would be meaningless. The one figure here that IS a range is the
 * footer's lifetime delta, which is why its `Since start:` prefix is mandatory
 * rather than decorative — it sits inside a band a window control appears to
 * govern, and the prefix is the only thing that says otherwise.
 */
type StatusBandProps = {
  client: Client;
  /**
   * The goal driving this client now, resolved from `client_goals` by the tab.
   * Both targets come from here, never from the `clients` mirror on `client`.
   */
  goal: EffectiveGoal;
  onOpenMetrics: () => void;
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
 * The two value tiers, taken from the white cards' StatStrip so the dark band
 * reads at the same scale as the rest of the Overview:
 *
 *  - "stat"  — a measurement. 18px mono, StatStrip's number tier.
 *  - "field" — a date. 13px; a deadline is a field the coach typed, not a
 *              headline, and should not out-shout the targets beside it.
 *
 * Both are `font-semibold`: STAT_VALUE_DARK_CLASS carries `font-bold` for the
 * 24-32px heroes it was written for, overridden here (cn merges) so this band
 * matches the semibold every white card uses.
 */
const VALUE_TIER = {
  stat: "text-[18px] font-semibold",
  field: "text-[13px] font-semibold",
} as const;

function BandCell({
  label,
  value,
  unit,
  tier = "stat",
  sub,
  subIsNumeric = true,
  chip,
  borderClass,
  emptyLabel = "Not set",
}: {
  label: string;
  value?: string;
  unit?: string;
  tier?: keyof typeof VALUE_TIER;
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
}) {
  return (
    <div className={cn("min-w-0 px-5 py-4", DIVIDER, borderClass)}>
      <p className={STAT_LABEL_DARK_CLASS}>{label}</p>
      <div className="mt-1">
        {value ? (
          <>
            <span className={cn(STAT_VALUE_DARK_CLASS, VALUE_TIER[tier], "leading-tight")}>
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
      {sub && (
        <p
          className={cn(
            "mt-1 truncate text-[11px] text-[rgba(255,255,255,0.3)]",
            subIsNumeric && MONO
          )}
        >
          {sub}
        </p>
      )}
      {chip && (
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

export function StatusBand({ client, goal, onOpenMetrics }: StatusBandProps) {
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

  return (
    <div
      className="flex flex-col rounded-[6px] bg-[#0f2027] animate-card-in"
      style={{ animationDelay: "0.04s" }}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4">
        <BandCell
          label="Goal weight"
          value={goalWeight?.toFixed(1)}
          unit={weightUnit}
          chip={weightChip}
        />
        <BandCell
          label="Goal body fat"
          value={goalBodyFat?.toFixed(1)}
          unit="%"
          chip={bfChip}
          borderClass="border-l"
        />
        <BandCell
          label="BMR"
          value={client.bmr ? Math.round(client.bmr).toString() : undefined}
          unit="cal/day"
          emptyLabel="Not recorded"
          sub={client.tdee ? `TDEE ${Math.round(client.tdee)}` : undefined}
          borderClass="border-t lg:border-l lg:border-t-0"
        />
        <BandCell
          label="Deadline"
          value={goal.deadline ? formatDateOnlyShort(goal.deadline) : undefined}
          tier="field"
          sub={remaining?.text}
          subIsNumeric={remaining?.isNumeric ?? false}
          borderClass="border-l border-t lg:border-t-0"
        />
      </div>

      <div className={cn("flex items-center gap-4 border-t px-5 py-3", DIVIDER)}>
        {sinceStart.length > 0 && (
          // "Since start:" is load-bearing, not decoration. This is the one
          // LIFETIME figure inside a band the Progression rail's window control
          // appears to govern; without the prefix it reads as the window's.
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
