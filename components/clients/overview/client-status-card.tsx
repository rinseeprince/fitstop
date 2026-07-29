"use client";

import type { ReactNode } from "react";
import { Calculator, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { goalState } from "@/lib/goals/goal-state";
import { containsDigit } from "@/components/clients/metrics/metrics-format";
import { formatDateOnlyShort } from "./overview-format";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { Client } from "@/types/check-in";
import type { OverviewPlanSummary } from "@/types/coach-overview";

type ClientStatusCardProps = {
  client: Client;
  training: OverviewPlanSummary["training"];
  upcomingTraining: OverviewPlanSummary["upcomingTraining"];
  isCalculatingBMR: boolean;
  onCalculateBMR: () => void;
  onOpenMetrics: () => void;
};

// Translucent on-dark chip — same recipe as the training-summary and metric
// heroes (training-summary-hero.tsx:67-79); digit-bearing chips go mono.
const CHIP_DARK_CLASS =
  "rounded-[3px] bg-[rgba(255,255,255,0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[rgba(255,255,255,0.4)]";

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

function MetricCell({
  label,
  value,
  unit,
  size = "md",
  sub,
  subTone,
  chip,
  showLeftBorder,
}: {
  label: string;
  value?: string;
  unit: string;
  size?: "lg" | "md";
  sub?: string;
  subTone?: string;
  chip?: { text: string; tone: ChipTone } | null;
  showLeftBorder?: boolean;
}) {
  return (
    <div className={showLeftBorder ? cn("border-l pl-3", DIVIDER) : undefined}>
      <p className={STAT_LABEL_DARK_CLASS}>{label}</p>
      <div className="mt-1">
        {value ? (
          <>
            <span
              className={cn(
                STAT_VALUE_DARK_CLASS,
                size === "lg" ? "text-[22px]" : "text-[20px]",
                "leading-tight"
              )}
            >
              {value}
            </span>
            <span className="ml-1 text-[10px] text-[rgba(255,255,255,0.30)]">{unit}</span>
          </>
        ) : (
          <span className="text-[13px] text-[rgba(255,255,255,0.30)]">Not recorded</span>
        )}
      </div>
      {sub && (
        <p className={cn(MONO, "mt-0.5 text-[9px]", subTone ?? "text-[rgba(255,255,255,0.25)]")}>
          {sub}
        </p>
      )}
      {chip && (
        <span
          className={cn(
            "mt-1 inline-block rounded-[4px] px-1.5 py-0.5 text-[9px] font-medium",
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

/**
 * `mono` is explicit rather than digit-sniffed: a plan name is user-authored, so
 * any digits in it are part of the name, not the datum (design-system tie-break).
 */
function DarkChip({ children, mono }: { children: string; mono?: boolean }) {
  return (
    <span className={cn(CHIP_DARK_CLASS, "max-w-[180px] truncate", mono && MONO)}>{children}</span>
  );
}

function deltaTone(delta: string | null): string | undefined {
  if (!delta) return undefined;
  return delta.startsWith("-") ? "text-[#0d9488]" : "text-[#d97706]";
}

export function ClientStatusCard({
  client,
  training,
  upcomingTraining,
  isCalculatingBMR,
  onCalculateBMR,
  onOpenMetrics,
}: ClientStatusCardProps) {
  const weightUnit = client.weightUnit || "lbs";
  const weightDelta = formatDelta(client.currentWeight, client.startingWeight);
  const bfDelta = formatDelta(client.currentBodyFatPercentage, client.startingBodyFatPercentage);

  const weightChip = goalChip(
    client.startingWeight,
    client.currentWeight,
    client.goalWeight,
    weightUnit
  );
  const bfChip = goalChip(
    client.startingBodyFatPercentage,
    client.currentBodyFatPercentage,
    client.goalBodyFatPercentage,
    "%"
  );

  // The active training block — this card's only programme context. There is no
  // roadmap or phase concept on the platform. A program placed to start later
  // reads as queued, never as "No plan".
  const blockChips: ReactNode = training ? (
    <>
      <DarkChip>{training.planName}</DarkChip>
      {training.currentWeek !== null && training.programDurationWeeks !== null && (
        <DarkChip mono>{`Week ${training.currentWeek} of ${training.programDurationWeeks}`}</DarkChip>
      )}
      <DarkChip>{training.currentWeek === null ? "Ended" : "Active"}</DarkChip>
    </>
  ) : upcomingTraining ? (
    <>
      <DarkChip>{upcomingTraining.planName}</DarkChip>
      <DarkChip mono>{`Starts ${formatDateOnlyShort(upcomingTraining.startsOn)}`}</DarkChip>
    </>
  ) : (
    <DarkChip>No plan</DarkChip>
  );

  return (
    <div
      className="flex flex-1 flex-col rounded-[6px] bg-[#0f2027] animate-card-in"
      style={{ animationDelay: "0.1s" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-4">
        <h3 className="text-[15px] font-bold text-white">Client status</h3>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">{blockChips}</div>
      </div>

      <div className="flex-1 pb-4">
        <div className="grid grid-cols-3 gap-3 px-5 pb-3">
          <MetricCell
            label="Start weight"
            value={client.startingWeight?.toFixed(1)}
            unit={weightUnit}
            size="lg"
          />
          <MetricCell
            label="Current weight"
            value={client.currentWeight?.toFixed(1)}
            unit={weightUnit}
            size="lg"
            sub={weightDelta ? `${weightDelta}${weightUnit}` : undefined}
            subTone={deltaTone(weightDelta)}
            showLeftBorder
          />
          <MetricCell
            label="Goal weight"
            value={client.goalWeight?.toFixed(1)}
            unit={weightUnit}
            size="lg"
            chip={weightChip}
            showLeftBorder
          />
        </div>

        <div className={cn("mx-5 border-t", DIVIDER)} />

        <div className="grid grid-cols-3 gap-3 px-5 py-3">
          <MetricCell
            label="Start body fat"
            value={client.startingBodyFatPercentage?.toFixed(1)}
            unit="%"
          />
          <MetricCell
            label="Current body fat"
            value={client.currentBodyFatPercentage?.toFixed(1)}
            unit="%"
            sub={bfDelta ? `${bfDelta}%` : undefined}
            subTone={deltaTone(bfDelta)}
            showLeftBorder
          />
          <MetricCell
            label="Goal body fat"
            value={client.goalBodyFatPercentage?.toFixed(1)}
            unit="%"
            chip={bfChip}
            showLeftBorder
          />
        </div>

        <div className={cn("mx-5 border-t", DIVIDER)} />

        <div className="grid grid-cols-3 items-end gap-3 px-5 pt-3">
          <MetricCell
            label="BMR"
            value={client.bmr ? Math.round(client.bmr).toString() : undefined}
            unit="cal/day"
          />
          <MetricCell
            label="TDEE"
            value={client.tdee ? Math.round(client.tdee).toString() : undefined}
            unit="cal/day"
            showLeftBorder
          />
          <div className={cn("flex justify-end border-l pl-3", DIVIDER)}>
            <button
              type="button"
              onClick={onCalculateBMR}
              disabled={isCalculatingBMR}
              className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[rgba(13,148,136,0.25)] bg-[rgba(13,148,136,0.15)] px-3 text-[11px] font-medium text-[#0d9488] transition-colors hover:bg-[rgba(13,148,136,0.25)] disabled:opacity-50"
            >
              {isCalculatingBMR ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Calculator className="h-3 w-3" strokeWidth={1.5} />
              )}
              Calculate BMR
            </button>
          </div>
        </div>
      </div>

      <div className="mt-auto flex justify-end border-t border-[rgba(255,255,255,0.06)] px-5 py-3">
        <button
          type="button"
          onClick={onOpenMetrics}
          className="text-[11px] font-medium text-[#0d9488] transition-colors hover:text-white"
        >
          Open Metrics
        </button>
      </div>
    </div>
  );
}
