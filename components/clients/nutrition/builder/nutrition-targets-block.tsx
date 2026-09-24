"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { MacroBalance } from "@/components/clients/nutrition/macro-balance";
import { Skeleton } from "@/components/ui/skeleton";
import type { MacroBalanceValue } from "@/lib/nutrition/macro-balance";
import type { MacroTargets } from "@/hooks/use-manual-targets";
import type { NutritionPlan } from "@/services/nutrition-service";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";

type NutritionTargetsBlockProps = {
  /** The live auto result — what auto mode shows, and what "Edit manually"
   *  seeds the balancer from. */
  autoPlan: NutritionPlan | null;
  autoTargets: MacroTargets | null;
  manualEnabled: boolean;
  onEnableManual: (from: MacroTargets) => void;
  onRevertToAuto: () => void;
  /** The coach's calorie target and split once they have taken over. */
  balance: MacroBalanceValue;
  onBalanceChange: (next: MacroBalanceValue) => void;
  /** `validateClientForNutrition` messages when the client lacks the data the
   *  calculator needs. Non-empty means nothing can be previewed at all. */
  missing: string[];
  /** Whether the Starts on day's goal has BOTH a weight target and a deadline —
   *  the pair the calculator needs before it can solve for anything but
   *  maintenance. Only then does this block explain a maintenance result
   *  itself — a deadline on or before the day the plan starts, or a goal
   *  weight the client already weighs; every other reason is the Goal line's. */
  hasGoalTarget: boolean;
  /** The Starts on day's goal and inputs are still loading: the auto numbers
   *  are pending, never another day's. */
  pending: boolean;
  /** That read failed: nothing can be priced until it is retried. */
  failed: boolean;
  onRetry: () => void;
};

const FIELD_CLASS =
  "w-full rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white px-2 py-1.5 text-center text-[15px] font-semibold text-[#0c1a1e] transition-all read-only:bg-[#f7faf9] read-only:text-[#5a7d82] hover:border-[rgba(13,148,136,0.25)] read-only:hover:border-[rgba(13,148,136,0.08)]";

/**
 * The calorie + macro targets, live.
 *
 * Auto shows the four numbers the pickers above produce, as they move. "Edit
 * manually" hands them to the macro balancer — one calorie target over a
 * two-thumb split (`components/clients/nutrition/macro-balance.tsx`), seeded
 * from the auto numbers so the coach starts from the calculation and nudges.
 * The grams derive from the split, so nothing here can disagree with itself
 * and there is nothing to reconcile.
 */
export function NutritionTargetsBlock({
  autoPlan,
  autoTargets,
  manualEnabled,
  onEnableManual,
  onRevertToAuto,
  balance,
  onBalanceChange,
  missing,
  hasGoalTarget,
  pending,
  failed,
  onRetry,
}: NutritionTargetsBlockProps) {
  // The coach's own unit. This block is "use client" and already inside the
  // builder tree, so no prop thread is needed.
  const { preference } = useUnits();

  // A weekly rate of body-weight change: formatWeight, which converts freely.
  // NOT formatLoad — nothing is being loaded on a bar, so snapping to 5 lb
  // would turn a 0.75 kg/week target into a meaningless 1.5 lbs/week.
  const weeklyChange = formatWeight(autoPlan?.weeklyWeightChangeKg ?? 0, preference);

  // The Starts on day's read failed: say so, with the retry, rather than a
  // plausible-looking set of numbers for some other day.
  if (failed) {
    return (
      <div className="space-y-2">
        <label className={SECTION_LABEL_CLASS}>Targets</label>
        <div className="flex items-start gap-2.5 rounded-[6px] bg-[rgba(245,158,11,0.07)] p-3.5">
          <AlertCircle
            className="mt-0.5 h-3 w-3 flex-shrink-0 text-[#d97706]"
            strokeWidth={1.5}
          />
          <p className="flex-1 text-[11.5px] font-medium leading-[1.4] text-[#d97706]">
            Couldn&apos;t work out the targets for this day.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              FOCUS_RING,
              "shrink-0 rounded-[4px] text-[11.5px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
            )}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Nothing can be calculated for this client yet. Say which data is missing
  // rather than rendering a plausible-looking zero — a browser has no
  // equivalent of the server's validate-then-assert, so an ungated calculation
  // here yields NaN (undefined bmr) or 0 (null bmr), and 0 reads as a number.
  if (missing.length > 0) {
    return (
      <div className="space-y-2">
        <label className={SECTION_LABEL_CLASS}>Targets</label>
        <div className="flex items-start gap-2.5 rounded-[6px] bg-[rgba(245,158,11,0.07)] p-3.5">
          <AlertCircle
            className="mt-0.5 h-3 w-3 flex-shrink-0 text-[#d97706]"
            strokeWidth={1.5}
          />
          <div className="space-y-1">
            {missing.map((m) => (
              <p key={m} className="text-[11.5px] font-medium leading-[1.4] text-[#d97706]">
                {m}
              </p>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Exactly the condition that suppresses both explanatory spans below.
  const isMaintenance =
    autoPlan != null &&
    autoPlan.requiredDailyDeficit === 0 &&
    autoPlan.weeklyWeightChangeKg === 0;
  // The calculator holds a deadline on or before the plan's first day at
  // maintenance — the deadline is the weigh-in, so it leaves no days to eat
  // to it — and says so with this code (services/nutrition-service.ts).
  const deadlineByStart =
    autoPlan?.warnings.some((warning) => warning.code === "deadline_passed") ?? false;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <label className={SECTION_LABEL_CLASS}>Targets</label>
        <SegmentedControl
          options={[
            { value: "auto", label: "Auto" },
            { value: "manual", label: "Edit manually" },
          ]}
          value={manualEnabled ? "manual" : "auto"}
          onChange={(v) => {
            if (v === "manual") {
              // Seed from what is on screen RIGHT NOW, not from whatever the
              // plan happened to store. Switching to manual on an auto plan
              // used to present a row of zeros instead of the live numbers.
              if (autoTargets) onEnableManual(autoTargets);
            } else {
              onRevertToAuto();
            }
          }}
        />
      </div>

      {manualEnabled ? (
        <MacroBalance value={balance} onChange={onBalanceChange} />
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <Field label="kcal" value={autoTargets?.calories ?? null} pending={pending} />
          <Field label="Protein" suffix="g" value={autoTargets?.proteinG ?? null} pending={pending} />
          <Field label="Carbs" suffix="g" value={autoTargets?.carbG ?? null} pending={pending} />
          <Field label="Fat" suffix="g" value={autoTargets?.fatG ?? null} pending={pending} />
        </div>
      )}

      {/* What the calculation is doing, so the number is explicable rather than
          arbitrary. Numerals in mono; the words around them stay sans. */}
      {autoPlan && !manualEnabled && (
        <p className="text-[11px] leading-[1.4] text-[#93b0b4]">
          TDEE <span className={cn(MONO, "text-[#5a7d82]")}>{autoPlan.tdee.toLocaleString()}</span>
          {autoPlan.requiredDailyDeficit !== 0 && (
            <>
              {" · "}
              <span className={cn(MONO, "text-[#5a7d82]")}>
                {autoPlan.requiredDailyDeficit > 0 ? "−" : "+"}
                {Math.abs(Math.round(autoPlan.requiredDailyDeficit)).toLocaleString()}
              </span>
              /day
            </>
          )}
          {autoPlan.weeklyWeightChangeKg !== 0 && (
            <>
              {" · "}
              <span className={cn(MONO, "text-[#5a7d82]")}>
                {autoPlan.weeklyWeightChangeKg > 0 ? "+" : "−"}
                {Math.abs(weeklyChange.value).toFixed(2)}
              </span>
              {` ${weeklyChange.unit}/week`}
            </>
          )}
        </p>
      )}

      {/* Both spans above are suppressed at exactly zero. When the goal has a
          weight target and a deadline and the numbers still hold at
          maintenance, either the deadline falls on or before the day the plan
          starts or the target IS the client's weight — said here, because
          nothing else explains it; the Goal line above shows the goal itself. No goal, no
          weight target and no deadline are the Goal line's to say
          (docs/MEASUREMENT-LOG-PLAN.md commit 8d1): one place per reason.

          A full sentence, so 100% sans (prose rule) — including the numerals. */}
      {autoPlan && !manualEnabled && isMaintenance && hasGoalTarget && (
        <p className="text-[11px] leading-[1.4] text-[#93b0b4]">
          {deadlineByStart
            ? "The goal's deadline is on or before the day this plan starts, so these targets hold at maintenance."
            : "The goal weight matches the client's current weight, so these targets hold at maintenance."}
        </p>
      )}

      {/* Manual wins: a picker change recalculates in the background and is
          offered here, never written into the coach's numbers. */}
      {manualEnabled && autoTargets && (
        <p className="text-[11px] leading-[1.4] text-[#93b0b4]">
          Auto suggests{" "}
          <span className={cn(MONO, "text-[#5a7d82]")}>
            {autoTargets.calories.toLocaleString()}
          </span>{" "}
          kcal ·{" "}
          <button
            type="button"
            onClick={onRevertToAuto}
            className={cn(
              FOCUS_RING,
              "rounded-[4px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
            )}
          >
            Revert to auto
          </button>
        </p>
      )}
    </div>
  );
}

/** A read-only cell of the auto result; a skeleton at its size while pending. */
function Field({
  label,
  suffix,
  value,
  pending,
}: {
  label: string;
  suffix?: string;
  value: number | null;
  pending: boolean;
}) {
  return (
    <div className="space-y-1">
      {pending ? (
        <Skeleton className="h-[38px] w-full rounded-[6px]" />
      ) : (
        <input
          type="number"
          readOnly
          tabIndex={-1}
          value={value ?? ""}
          className={cn(MONO, FIELD_CLASS, FOCUS_RING)}
        />
      )}
      <p className={cn(LABEL_CLASS, "text-center")}>
        {label}
        {suffix ? ` (${suffix})` : ""}
      </p>
    </div>
  );
}
