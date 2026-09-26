"use client";

import { cn } from "@/lib/utils";
import { formatDateOnlyShort } from "@/lib/date-helpers";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  LABEL_CLASS,
  MONO,
  MONO_META_CLASS,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";
import type { NutritionDay, NutritionDayStatus } from "@/types/schedule";
import { dayLabel } from "./day-label";

type NutritionSectionProps = {
  /**
   * The period's nutrition figures, server-computed by the ONE kernel
   * (`utils/nutrition-period-summary.ts`) and carried on the detail wire, with
   * the week's food rows as the check-in froze them (`days`). The card renders
   * them and counts nothing of its own — it takes no log rows and judges no
   * day, so a day can never be priced one way here and another on the ribbon,
   * and a sent week never rewords itself. `null` on a legacy row whose period
   * cannot be resolved: the card renders nothing rather than a second
   * definition.
   */
  nutrition: CheckInPeriodAdherence["nutrition"] | null;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const kcal = (value: number) => value.toLocaleString();
// A figure the frozen row does not hold: a placeholder, not punctuation.
const grams = (value: number | null) => (value == null ? "—" : `${value}g`);

// The day's word and its colour, from the standing the check-in froze at Send
// and never re-judged from the row's numbers. One meaning per colour, the
// adherence rail's rule (components/clients/overview/adherence-card.tsx): teal
// on target, amber partial, rose missed, the faint tint for a targeted day with
// no food log; nothing to judge wears no colour. "No food logged" rather than
// "Not logged" because the header chip counts days with ANY log and this list
// counts food, and the two sit on one screen.
const DAY_STANDING: Record<NutritionDayStatus, { label: string; pill: string }> = {
  hit: { label: "On target", pill: "bg-[rgba(13,148,136,0.08)] text-[#0d9488]" },
  partial: { label: "Partial", pill: "bg-[rgba(245,158,11,0.07)] text-[#d97706]" },
  missed: { label: "Missed", pill: "bg-[rgba(192,96,96,0.08)] text-[#c06060]" },
  not_logged: { label: "No food logged", pill: "bg-[rgba(13,148,136,0.04)] text-[#93b0b4]" },
  no_target: { label: "No target", pill: "text-[#93b0b4]" },
};

const MACROS = [
  ["Protein", "actualProteinG", "targetProteinG"],
  ["Carbs", "actualCarbsG", "targetCarbsG"],
  ["Fats", "actualFatG", "targetFatG"],
] as const;

/**
 * Each macro eaten against its target, in the grammar of the averages above
 * ("169g / 172g"): the targets alone on a day with no food logged, the eaten
 * alone on a day no target covered, nothing on a day with neither.
 */
function macroLine(day: NutritionDay): string | null {
  const logged = day.actualCalories != null;
  const targeted = day.targetCalories != null;
  if (!logged && !targeted) return null;
  return MACROS.map(([label, eatenKey, targetKey]) => {
    const eaten = grams(day[eatenKey]);
    const target = grams(day[targetKey]);
    if (logged && targeted) return `${label} ${eaten} / ${target}`;
    return `${label} ${targeted ? target : eaten}`;
  }).join(" · ");
}

/** "2,260 of 2,300 kcal"; the target alone with no food logged; the eaten alone with no target. */
function CaloriesLine({ day }: { day: NutritionDay }) {
  const eaten = day.actualCalories;
  const target = day.targetCalories;
  const muted = cn(MONO_META_CLASS, "text-[13px]");
  if (eaten == null && target == null) return <span className={muted}>—</span>;
  if (eaten == null) return <span className={muted}>{kcal(target!)} kcal target</span>;
  return (
    <>
      <span className={cn(MONO, "text-[13px] font-medium", TEXT_PRIMARY)}>{kcal(eaten)}</span>
      <span className={muted}>{target == null ? " kcal" : ` of ${kcal(target)} kcal`}</span>
    </>
  );
}

/** One day of the week, as the check-in froze it. */
function DayRow({ day }: { day: NutritionDay }) {
  const standing = DAY_STANDING[day.status];
  const macros = macroLine(day);
  return (
    <div className="rounded-[6px] bg-[rgba(13,148,136,0.03)] px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className={cn(LABEL_CLASS, "w-8 shrink-0")}>{dayLabel(day.date)}</span>
        <span className={cn(MONO_META_CLASS, "w-12 shrink-0 text-[11px]")}>
          {formatDateOnlyShort(day.date)}
        </span>
        <div className="min-w-0 flex-1">
          <CaloriesLine day={day} />
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-[4px] px-2 py-0.5 text-[11px] font-medium",
            standing.pill
          )}
        >
          {standing.label}
        </span>
      </div>
      {macros && <div className={cn(MONO_META_CLASS, "mt-1 text-[11px]")}>{macros}</div>}
    </div>
  );
}

export const NutritionSection = ({ nutrition }: NutritionSectionProps) => {
  if (!nutrition || nutrition.loggedDays === 0) return null;

  // Every figure on this card is over ONE day set, named by the kernel. The
  // total and the pill are the adherence question — intake on the targeted
  // days against every targeted day's target, a skipped day counting against
  // — and the averages are per JUDGED day, so an intake average and the
  // target beside it cover the same days. A logged day with no target is in
  // neither: it is named on the card so the coach can see where it went, and
  // it moves no number.
  const { targetTotals, consumedOnTargetedDays, perJudgedDay, intakePerLoggedDay } = nutrition;
  const verdict = nutrition.periodVerdict?.toUpperCase() ?? null;
  const fillPct =
    targetTotals && consumedOnTargetedDays && targetTotals.calories > 0
      ? Math.min((consumedOnTargetedDays.calories / targetTotals.calories) * 100, 100)
      : 0;
  const noTargetNote =
    nutrition.loggedNoTargetDays > 0
      ? `${plural(nutrition.loggedNoTargetDays, "logged day")} had no target and ${
          nutrition.loggedNoTargetDays === 1 ? "is" : "are"
        } not counted`
      : null;

  const macros = perJudgedDay
    ? [
        { label: "Protein", actual: perJudgedDay.consumed.proteinG, target: perJudgedDay.target.proteinG, colorClass: "bg-protein" },
        { label: "Carbs", actual: perJudgedDay.consumed.carbsG, target: perJudgedDay.target.carbsG, colorClass: "bg-carbs" },
        { label: "Fats", actual: perJudgedDay.consumed.fatG, target: perJudgedDay.target.fatG, colorClass: "bg-fat" },
      ]
    : [];

  return (
    // A flex ITEM, not a grid cell: the page puts this beside its sibling, and
    // either section can return null on an empty week. A null child emits no
    // node, so the survivor takes the full row without the page having to know
    // which one rendered. `min-w-0` stops the mono numerals setting the basis.
    <div className="flex min-w-0 flex-1 flex-col">
      {/* No coverage count here (owner, 2026-09-04): the header's chip states
          the week's logged days once, and the pill states days on target —
          coverage and adherence are different questions. */}
      <SectionLabel label="Nutrition" />
      <div className="flex-1 rounded-[6px] bg-white p-5">
        <div className="flex flex-col gap-4">
          {targetTotals && consumedOnTargetedDays ? (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-baseline">
                <div>
                  <div className={cn("text-[28px] font-bold tracking-tight", MONO, TEXT_PRIMARY)}>
                    {consumedOnTargetedDays.calories.toLocaleString()}
                  </div>
                  <div className="text-xs text-[#93b0b4]">
                    of {targetTotals.calories.toLocaleString()} kcal target
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-[4px]",
                    MONO,
                    verdict === "HIT"
                      ? "bg-[rgba(13,148,136,0.08)] text-[#0d9488]"
                      : "bg-[rgba(245,158,11,0.07)] text-[#d97706]"
                  )}
                >
                  {verdict}
                  {` · ${nutrition.onTarget}/${nutrition.targetedDays} on target`}
                </span>
              </div>
              <div className="h-2 bg-[rgba(13,148,136,0.06)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0d9488] rounded-full transition-all duration-500"
                  style={{ width: `${fillPct}%` }}
                />
              </div>
              <div className="text-[11px] text-[#93b0b4] italic">
                {perJudgedDay
                  ? `Avg ${perJudgedDay.consumed.calories.toLocaleString()} kcal / day`
                  : "Nothing logged on a day with a target"}
                {noTargetNote ? ` · ${noTargetNote}` : ""}
              </div>
            </div>
          ) : (
            // The coach prescribed nothing on any day of the period: there is
            // no target to compare with, so no total, no pill and no bar —
            // never 0 of 0, never a MISSED over nothing to hit.
            <p className="text-sm text-[#5a7d82]">
              No target was set on any day of this period. {plural(nutrition.loggedDays, "day")} logged
              {intakePerLoggedDay ? `, avg ${intakePerLoggedDay.calories.toLocaleString()} kcal / day` : ""}.
            </p>
          )}

          {/* Macros, under the calories they break down — per judged day on
              both sides of every bar. */}
          {perJudgedDay && (
            <div className="flex flex-col gap-2.5">
              <div className="text-xs font-medium text-[#5a7d82] mb-0.5">
                Avg macros / day
              </div>
              {macros.map((macro) => {
                const pct = macro.target > 0 ? Math.min((macro.actual / macro.target) * 100, 100) : 0;
                return (
                  <div key={macro.label} className="flex items-center gap-2.5">
                    <div className="text-xs font-medium text-[#5a7d82] w-14 shrink-0">
                      {macro.label}
                    </div>
                    <div className="flex-1 h-1.5 bg-[rgba(13,148,136,0.06)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${macro.colorClass}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className={cn(MONO_META_CLASS, "text-xs w-20 text-right shrink-0")}>
                      {macro.actual}g / {macro.target}g
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* The week day by day, under the summary it adds up to — every row
              a frozen row from the check-in's copy, in the copy's order, worded
              from its own standing. The list is the coach's figures per day;
              the summary stays because without it they would be adding the
              days up (owner, D7). */}
          <div className="flex flex-col gap-2">
            {nutrition.days.map((day) => (
              <DayRow key={day.date} day={day} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
