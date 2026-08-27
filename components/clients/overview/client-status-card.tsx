"use client";

import { cn } from "@/lib/utils";
import { goalState } from "@/lib/goals/goal-state";
import { containsDigit } from "@/components/clients/metrics/metrics-format";
import { formatDateOnlyShort } from "./overview-format";
import { GoalHistoryPopover } from "./goal-history-popover";
import {
  MONO,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { ActivityLevel, Client } from "@/types/check-in";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";

type ClientStatusCardProps = {
  client: Client;
  /**
   * The goal driving this client now, resolved from `client_goals` by the tab.
   * Both targets come from here, never from the `clients` mirror on `client` —
   * this card reading the mirror directly was the last coach-side one that did.
   */
  goal: EffectiveGoal;
  /**
   * The STORED `client_goals.goal_start_date`, not the resolved one.
   * `EffectiveGoal.startDate` coalesces to today, which is right for a
   * calculator asking "spread the deficit from when?" and wrong for a display
   * asking "what did the coach set?" — rendering it would label every client
   * with no start date as starting today.
   */
  goalStartDate: string | null;
  onOpenMetrics: () => void;
};

const DIVIDER = "border-[rgba(255,255,255,0.07)]";

type ChipTone = "positive" | "warning";

const GOAL_CHIP_TONE: Record<ChipTone, string> = {
  positive: "bg-[rgba(13,148,136,0.15)] text-[#0d9488]",
  warning: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
};

/** Short enough for the status card's third column; the dialog carries the
 *  full "(desk job)" style descriptions. */
const ACTIVITY_SHORT_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary",
  lightly_active: "Lightly active",
  moderately_active: "Moderately active",
  very_active: "Very active",
  extremely_active: "Extremely active",
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
 * The two value tiers, taken from the white cards' StatStrip
 * (overview-primitives.tsx) so the dark card reads at the same scale as the
 * rest of the Overview rather than a size of its own:
 *
 *  - "stat"  — a measurement. 18px mono, StatStrip's number tier.
 *  - "field" — a date or a name. 13px, the tier the Client information card's
 *              own fields use; a deadline is a field the coach typed, not a
 *              headline, and should not out-shout the weights above it.
 *
 * Both are `font-semibold`: STAT_VALUE_DARK_CLASS carries `font-bold` for the
 * 24-32px heroes it was written for, and it is overridden here (cn merges) so
 * this strip matches the semibold every white card uses.
 */
const VALUE_TIER = {
  stat: "text-[18px] font-semibold",
  field: "text-[13px] font-semibold",
} as const;

function MetricCell({
  label,
  value,
  unit,
  tier = "stat",
  sub,
  subTone,
  chip,
  showLeftBorder,
  emptyLabel = "Not recorded",
}: {
  label: string;
  value?: string;
  unit: string;
  tier?: keyof typeof VALUE_TIER;
  sub?: string;
  subTone?: string;
  chip?: { text: string; tone: ChipTone } | null;
  showLeftBorder?: boolean;
  /** "Not recorded" fits a measurement; a date the coach never set is "Not set". */
  emptyLabel?: string;
}) {
  return (
    <div className={showLeftBorder ? cn("border-l pl-3", DIVIDER) : undefined}>
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
        <p className={cn(MONO, "mt-1 text-[11px]", subTone ?? "text-[rgba(255,255,255,0.3)]")}>
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

/**
 * Stat-band sub tones: neutral / up / warn.
 *
 * Flat used to fall through to warn — a client who had not moved at all showed
 * "0.0kg" in the warning amber, which is not a warning, it is no news. There was
 * no zero branch; it was an oversight rather than a decision.
 *
 * Direction still assumes a loss goal (down = good). That IS logic rather than
 * styling, so it is left exactly as it was.
 */
function deltaTone(delta: string | null): string | undefined {
  if (!delta) return undefined;
  if (Number(delta) === 0) return "text-[rgba(255,255,255,0.3)]";
  return delta.startsWith("-") ? "text-[#0d9488]" : "text-[#d97706]";
}

export function ClientStatusCard({
  client,
  goal,
  goalStartDate,
  onOpenMetrics,
}: ClientStatusCardProps) {
  // client.weightUnit is a mapper constant, not the viewer's choice (Batch F
  // deletes it). Body weights convert freely — formatWeight, never formatLoad.
  const { preference } = useUnits();
  const kg = (v: number | null | undefined) =>
    v == null ? undefined : formatWeight(v, preference).value;
  const weightUnit = formatWeight(0, preference).unit;

  const startWeight = kg(client.startingWeight);
  const currentWeight = kg(client.currentWeight);
  // Start and current stay on the `clients` cache — they are measurements, kept
  // fresh by recordBodyMetrics. Only the two TARGETS move to client_goals.
  const goalWeight = kg(goal.goalWeightKg);
  const goalBodyFat = goal.goalBodyFatPercentage ?? undefined;
  // Delta between the DISPLAYED values so it reconciles with the cells above it.
  const weightDelta = formatDelta(currentWeight, startWeight);
  const bfDelta = formatDelta(client.currentBodyFatPercentage, client.startingBodyFatPercentage);

  const weightChip = goalChip(startWeight, currentWeight, goalWeight, weightUnit);
  const bfChip = goalChip(
    client.startingBodyFatPercentage,
    client.currentBodyFatPercentage,
    goalBodyFat,
    "%"
  );

  return (
    <div
      className="flex flex-1 flex-col rounded-[6px] bg-[#0f2027] animate-card-in"
      style={{ animationDelay: "0.1s" }}
    >
      {/* CardHeader's own geometry and weight (overview-primitives.tsx), on dark. */}
      <div className="px-5 pb-3 pt-5">
        <h3 className="text-[15px] font-semibold text-white">Client status</h3>
      </div>

      <div className="flex flex-1 flex-col pb-4">
        <div className="grid flex-1 grid-cols-3 items-start gap-3 px-5 pb-3">
          <MetricCell
            label="Start weight"
            value={startWeight?.toFixed(1)}
            unit={weightUnit}
          />
          <MetricCell
            label="Current weight"
            value={currentWeight?.toFixed(1)}
            unit={weightUnit}
            sub={weightDelta ? `${weightDelta}${weightUnit}` : undefined}
            subTone={deltaTone(weightDelta)}
            showLeftBorder
          />
          <MetricCell
            label="Goal weight"
            value={goalWeight?.toFixed(1)}
            unit={weightUnit}
            chip={weightChip}
            showLeftBorder
          />
        </div>

        <div className={cn("mx-5 border-t", DIVIDER)} />

        <div className="grid flex-1 grid-cols-3 items-start gap-3 px-5 py-3">
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
            value={goalBodyFat?.toFixed(1)}
            unit="%"
            chip={bfChip}
            showLeftBorder
          />
        </div>

        <div className={cn("mx-5 border-t", DIVIDER)} />

        {/* The "Calculate BMR" button that used to sit here is gone. The pair
            recomputes automatically whenever any input to it changes, so a
            manual recalculate button was an admission that it didn't. The slot
            now says what the TDEE was derived FROM, which is the question a
            coach looking at these two numbers actually has. */}
        <div className="grid flex-1 grid-cols-3 items-start gap-3 px-5 pt-3">
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
          <div className={cn("border-l pl-3", DIVIDER)}>
            <p className={STAT_LABEL_DARK_CLASS}>Activity</p>
            <p className={cn("mt-1", VALUE_TIER.field, "text-[rgba(255,255,255,0.92)]")}>
              {ACTIVITY_SHORT_LABELS[client.workActivityLevel ?? "sedentary"]}
            </p>
          </div>
        </div>

        {/* The goal window. A fourth band in the same 3-column shape as the
            three above, because both dates are real inputs: the deadline is
            what turns a goal weight into a daily deficit at all (with none, the
            calculator returns maintenance) and the start date decides whether
            that deficit is spread from today or from a future date. The third
            column is deliberately empty — a derived "time left" readout would
            be a new invented stat, not a field this card owes. */}
        <div className={cn("mx-5 border-t", DIVIDER)} />

        <div className="grid flex-1 grid-cols-3 items-start gap-3 px-5 pt-3">
          <MetricCell
            label="Goal start"
            value={goalStartDate ? formatDateOnlyShort(goalStartDate) : undefined}
            unit=""
            tier="field"
            emptyLabel="Not set"
          />
          <MetricCell
            label="Deadline"
            value={goal.deadline ? formatDateOnlyShort(goal.deadline) : undefined}
            unit=""
            tier="field"
            showLeftBorder
            emptyLabel="Not set"
          />
        </div>
      </div>

      {/* Two text buttons now. History is the muted one: it is a reference, not
          a destination, and only the primary action carries the teal. */}
      <div className="mt-auto flex items-center justify-end gap-4 border-t border-[rgba(255,255,255,0.07)] px-5 py-3">
        <GoalHistoryPopover clientId={client.id} />
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
