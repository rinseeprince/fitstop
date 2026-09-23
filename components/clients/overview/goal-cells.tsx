"use client";

import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { containsDigit } from "@/components/clients/metrics/metrics-format";
import {
  FOCUS_RING,
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { TextSkeleton } from "@/components/text-skeleton";
import { goalProgressChip, type GoalChipTone } from "@/lib/goals/goal-chip";
import { goalTypeBesideName } from "@/lib/goals/goal-types";
import { formatDateOnlyShort } from "@/lib/date-helpers";
import type { CurrentGoal, GoalOnDay } from "@/types/client-goals";

/**
 * The goal card's two cells in the Overview's dark band: the goal — its name,
 * its type where the name does not say it, the goal planned next, and the
 * pencil that opens the goals sheet — and its targets, each with how far the
 * client is from it. The deadline and the energy pair are the band's other two
 * cells.
 */

export const BAND_DIVIDER = "border-[rgba(255,255,255,0.07)]";
const EMPTY_CLASS = "text-[13px] text-[rgba(255,255,255,0.3)]";
const SUB_CLASS = "mt-1 truncate text-[11px] text-[rgba(255,255,255,0.3)]";
/** The band's one value tier: 18px mono semibold (status-band.tsx). */
export const BAND_VALUE_CLASS = "text-[18px] font-semibold";

const GOAL_CHIP_TONE: Record<GoalChipTone, string> = {
  positive: "bg-[rgba(13,148,136,0.15)] text-[#0d9488]",
  warning: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
};

function GoalChip({ chip }: { chip: { text: string; tone: GoalChipTone } }) {
  return (
    <span
      className={cn(
        // CHIP_NEUTRAL_CLASS's geometry (10px / px-1.5 / py-px), tinted.
        "inline-block rounded-[4px] px-1.5 py-px text-[10px] font-medium",
        GOAL_CHIP_TONE[chip.tone],
        containsDigit(chip.text) && MONO
      )}
    >
      {chip.text}
    </span>
  );
}

function BandCellFrame({
  label,
  action,
  borderClass,
  children,
}: {
  label: string;
  action?: ReactNode;
  borderClass?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 px-5 py-4", BAND_DIVIDER, borderClass)}>
      <div className="flex items-center justify-between gap-2">
        <p className={STAT_LABEL_DARK_CLASS}>{label}</p>
        {action}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const pendingValue = (
  <span className={cn(STAT_VALUE_DARK_CLASS, BAND_VALUE_CLASS, "leading-tight")}>
    <TextSkeleton className="w-14" />
  </span>
);

/** The goal in force: its name, its type beside the name, and what comes next. */
export function GoalCell({
  goal,
  nextGoal,
  pending,
  failed,
  onEditGoals,
}: {
  goal: CurrentGoal | null;
  nextGoal: GoalOnDay | null;
  pending: boolean;
  failed: boolean;
  onEditGoals: () => void;
}) {
  const type = goal ? goalTypeBesideName(goal.type, goal.name) : null;
  return (
    <BandCellFrame
      label="Goal"
      action={
        <button
          type="button"
          onClick={onEditGoals}
          aria-label="Edit goals"
          title="Edit goals"
          className={cn(
            "grid h-4 w-4 place-items-center rounded-[4px] text-[rgba(255,255,255,0.45)] transition-colors hover:text-white",
            FOCUS_RING
          )}
        >
          <Pencil className="h-3 w-3" strokeWidth={1.5} />
        </button>
      }
    >
      {pending ? (
        pendingValue
      ) : failed ? (
        <span className={EMPTY_CLASS}>Couldn&apos;t load the goal</span>
      ) : goal ? (
        <span className="block truncate text-[15px] font-semibold leading-tight text-white">
          {goal.name}
        </span>
      ) : (
        <span className={EMPTY_CLASS}>Not set</span>
      )}
      {!pending && !failed && type && <p className={SUB_CLASS}>{type}</p>}
      {!pending && !failed && nextGoal && (
        <p className={SUB_CLASS}>
          Next: {nextGoal.name} from {formatDateOnlyShort(nextGoal.startsOn)}
        </p>
      )}
    </BandCellFrame>
  );
}

/**
 * Each target the goal has, in the viewer's unit, with how far the client is
 * from it — measured from their reading on the goal's start day, in the
 * direction its type sets.
 */
export function TargetCell({
  goal,
  currentWeight,
  currentBodyFat,
  toDisplayWeight,
  weightUnit,
  pending,
  failed,
  borderClass,
}: {
  goal: CurrentGoal | null;
  /** The newest readings, weight already in the viewer's unit. */
  currentWeight: number | undefined;
  currentBodyFat: number | undefined;
  toDisplayWeight: (kg: number | null | undefined) => number | undefined;
  weightUnit: string;
  pending: boolean;
  failed: boolean;
  borderClass?: string;
}) {
  const rows: { key: string; value: string; unit: string; chip: ReturnType<typeof goalProgressChip> }[] = [];
  if (goal?.targetWeight != null) {
    const target = toDisplayWeight(goal.targetWeight);
    rows.push({
      key: "weight",
      value: target?.toFixed(1) ?? "",
      unit: weightUnit,
      chip: goalProgressChip({
        type: goal.type,
        metric: "weight",
        start: toDisplayWeight(goal.startReadings.weight),
        current: currentWeight,
        target,
        unit: weightUnit,
      }),
    });
  }
  if (goal?.targetBodyFatPercentage != null) {
    rows.push({
      key: "bodyFat",
      value: goal.targetBodyFatPercentage.toFixed(1),
      unit: "%",
      chip: goalProgressChip({
        type: goal.type,
        metric: "bodyFat",
        start: goal.startReadings.bodyFat,
        current: currentBodyFat,
        target: goal.targetBodyFatPercentage,
        unit: "%",
      }),
    });
  }

  return (
    <BandCellFrame label="Target" borderClass={borderClass}>
      {pending ? (
        pendingValue
      ) : failed ? (
        <span className={EMPTY_CLASS}>—</span>
      ) : !goal ? (
        <span className={EMPTY_CLASS}>Not set</span>
      ) : rows.length === 0 ? (
        <span className={EMPTY_CLASS}>No target</span>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.key}>
              <span className={cn(STAT_VALUE_DARK_CLASS, BAND_VALUE_CLASS, "leading-tight")}>
                {row.value}
              </span>
              <span className="ml-1 text-[11px] font-normal text-[rgba(255,255,255,0.30)]">
                {row.unit}
              </span>
              {/* Under its target, where the band's other cells put their second line. */}
              {row.chip && (
                <div className="mt-1">
                  <GoalChip chip={row.chip} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </BandCellFrame>
  );
}
