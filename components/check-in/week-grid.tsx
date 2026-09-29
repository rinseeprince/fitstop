"use client";

import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  LABEL_CLASS,
  MONO,
  MONO_META_CLASS,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { TrainingAdherence } from "@/lib/training-adherence";
import type { CheckInExerciseHighlight, CheckInTrainingEventDetail } from "@/types/check-in";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";
import { dayLabel } from "./day-label";
import { CaloriesRow, GridRow, MacroRow, TrainingRow } from "./week-grid-rows";
import { DAY_STANDING, MACROS, MACRO_MARK, NO_FOOD_BOX, TARGET_LINE, noTargetNote } from "./week-grid-words";

type Nutrition = CheckInPeriodAdherence["nutrition"];

type WeekGridProps = {
  /** The week's days, oldest first — the copy's dates, else the check-in's period (a legacy row). */
  dates: string[];
  /** The week's workouts in calendar order — the review read's own rows. */
  workouts: CheckInTrainingEventDetail[];
  /** The page's one training count (`summariseTraining`); the grid counts nothing itself. */
  training: TrainingAdherence;
  highlights: CheckInExerciseHighlight[];
  /**
   * The nutrition kernel's figures and the week's food rows as the check-in
   * froze them, off the detail wire. `null` on a legacy row whose period
   * cannot be resolved: the grid shows the week's training alone.
   */
  nutrition: Nutrition | null;
};

const LABEL_COLUMN = "148px";
const AVERAGE_COLUMN = "88px";

/** The week's total against its target, the bar and the week's pill — the rail's right side. */
function WeekSummary({ nutrition }: { nutrition: Nutrition | null }) {
  if (!nutrition) return null;
  const { targetTotals, consumedOnTargetedDays } = nutrition;
  // The coach prescribed nothing all week: no total, no bar, no pill — never
  // 0 of 0, never MISSED over nothing to hit.
  if (!targetTotals || !consumedOnTargetedDays) {
    return <span className="whitespace-nowrap text-[11px] text-[#93b0b4]">No target set this week</span>;
  }
  const fill = targetTotals.calories > 0 ? Math.min((consumedOnTargetedDays.calories / targetTotals.calories) * 100, 100) : 0;
  const verdict = nutrition.periodVerdict?.toUpperCase() ?? null;
  return (
    <div className="flex items-center gap-3">
      <span className="whitespace-nowrap">
        <span className={cn(MONO, "text-[13px] font-semibold", TEXT_PRIMARY)}>
          {consumedOnTargetedDays.calories.toLocaleString()}
        </span>
        <span className={cn(MONO_META_CLASS, "text-[11px]")}> of {targetTotals.calories.toLocaleString()} kcal</span>
      </span>
      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[rgba(13,148,136,0.08)]" aria-hidden>
        <span className="block h-full rounded-full bg-[#0d9488]" style={{ width: `${fill}%` }} />
      </span>
      <span
        className={cn(
          "whitespace-nowrap rounded-[4px] px-2 py-0.5 text-[11px] font-semibold",
          MONO,
          verdict === "HIT" ? "bg-[rgba(13,148,136,0.08)] text-[#0d9488]" : "bg-[rgba(245,158,11,0.07)] text-[#d97706]"
        )}
      >
        {verdict} · {nutrition.onTarget}/{nutrition.targetedDays} on target
      </span>
    </div>
  );
}

const LEGEND = [
  { swatch: cn("h-2 w-2 rounded-[2px]", DAY_STANDING.hit.bar), label: DAY_STANDING.hit.label },
  { swatch: cn("h-2 w-2 rounded-[2px]", DAY_STANDING.partial.bar), label: DAY_STANDING.partial.label },
  { swatch: cn("h-2 w-2 rounded-[2px]", DAY_STANDING.missed.bar), label: DAY_STANDING.missed.label },
  { swatch: cn("h-2 w-2 rounded-[2px]", DAY_STANDING.no_target.bar), label: DAY_STANDING.no_target.label },
  { swatch: cn("h-2 w-2", NO_FOOD_BOX), label: DAY_STANDING.not_logged.label },
  { swatch: cn("h-[3px] w-3 rounded-full", TARGET_LINE), label: "Target" },
];

const MARK_LEGEND = [
  { swatch: cn("h-2.5 w-3 rounded-[2px]", MACRO_MARK.under.tint), label: "10%+ under" },
  { swatch: cn("h-2.5 w-3 rounded-[2px]", MACRO_MARK.over.tint), label: "10%+ over" },
];

function Legend({ items }: { items: { swatch: string; label: string }[] }) {
  return (
    <>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={cn("shrink-0", item.swatch)} aria-hidden />
          {/* Passive legend words stay normal-case muted sans (divider grammar). */}
          <span className="text-[10px] text-[#93b0b4]">{item.label}</span>
        </span>
      ))}
    </>
  );
}

/**
 * The check-in's week in one grid (owner, 2026-09-29): Training, Calories and
 * the three macros as rows under the same seven days, with each row's
 * average on the right. One card rather than a Training card beside a
 * Nutrition card, so the page never sets two cards of different heights side
 * by side. Every nutrition cell is a frozen row from the check-in's copy,
 * worded from its own standing; the grid takes no log rows and counts
 * nothing — the training figure is the page's `summariseTraining` run and the
 * averages are the kernel's.
 */
export function WeekGrid({ dates, workouts, training, highlights, nutrition }: WeekGridProps) {
  const { preference } = useUnits();
  if (dates.length === 0) return null;

  const template = { gridTemplateColumns: `${LABEL_COLUMN} repeat(${dates.length}, minmax(0, 1fr)) ${AVERAGE_COLUMN}` };
  const byDate = new Map((nutrition?.days ?? []).map((day) => [day.date, day]));
  const food = dates.map((date) => byDate.get(date) ?? null);
  const prHighlights = highlights.filter((highlight) => highlight.highlightType === "pr");
  const note = nutrition ? noTargetNote(nutrition.days) : null;

  return (
    <div>
      <SectionLabel label="Day by day" actions={<WeekSummary nutrition={nutrition} />} />
      <div className="rounded-[6px] bg-white p-5">
        {/* A narrow screen scrolls the week sideways rather than crushing seven columns. */}
        <div className="overflow-x-auto">
          <div className="min-w-[660px]">
            <GridRow
              name="days"
              template={template}
              padding="pb-2"
              label={null}
              cells={dates.map((date) => ({
                date,
                cell: (
                  <>
                    <span className={LABEL_CLASS}>{dayLabel(date)}</span>
                    <span className={cn(MONO, "text-[12.5px] font-medium", TEXT_PRIMARY)}>{Number(date.slice(8, 10))}</span>
                  </>
                ),
              }))}
              average={<span className={LABEL_CLASS}>Avg</span>}
            />
            <TrainingRow template={template} dates={dates} workouts={workouts} training={training} />
            {nutrition && (
              <>
                <CaloriesRow template={template} dates={dates} food={food} nutrition={nutrition} />
                {MACROS.map((macro) => (
                  <MacroRow key={macro.name} template={template} dates={dates} food={food} nutrition={nutrition} macro={macro} />
                ))}
              </>
            )}
          </div>
        </div>

        {/* PRs the client flagged this week. */}
        {prHighlights.length > 0 && (
          <div className="mt-4 flex items-center gap-2.5 rounded-[6px] border-l-[3px] border-l-[#0d9488] bg-[rgba(13,148,136,0.05)] p-3">
            <Trophy className="h-5 w-5 shrink-0 text-[#0d9488]" strokeWidth={1.5} />
            <div className="text-[13px] font-medium text-[#0c1a1e]">
              {prHighlights.map((pr, i) => (
                <span key={pr.id ?? i}>
                  {pr.exerciseName}
                  {(pr.weightValue || pr.reps) && (
                    <span className={cn("font-bold text-[#0d9488]", MONO)}>
                      {" "}
                      {/* A PR is a barbell load, so formatLoad — it snaps an
                          imperial conversion to something loadable. */}
                      {pr.weightValue &&
                        `${formatLoad(pr.weightValue, preference).value}${formatLoad(pr.weightValue, preference).unit}`}
                      {pr.weightValue && pr.reps && " x "}
                      {pr.reps && `${pr.reps} reps`}
                    </span>
                  )}
                  {pr.details && ` - ${pr.details}`}
                  {i < prHighlights.length - 1 && " | "}
                </span>
              ))}
            </div>
          </div>
        )}

        {nutrition && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[rgba(13,148,136,0.06)] pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Legend items={LEGEND} />
              <span className="h-3 w-px bg-[rgba(13,148,136,0.12)]" aria-hidden />
              <Legend items={MARK_LEGEND} />
            </div>
            {note && <span className="text-[11px] text-[#93b0b4]">{note}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
