"use client";

import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayOfMonth } from "@/lib/date-helpers";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LABEL_CLASS,
  MONO,
  MONO_CELL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { CheckInExerciseHighlight, CheckInTrainingEventDetail } from "@/types/check-in";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";
import { dayLabel } from "./day-label";
import { CaloriesCell, Dash, EatenOverTarget, MacroCell, StandingCell, TrainingCell } from "./week-grid-rows";
import { MACROS, MACRO_MARK, TARGET_TICK } from "./week-grid-words";

type Nutrition = CheckInPeriodAdherence["nutrition"];

type WeekGridProps = {
  /** The week's days, oldest first — the copy's dates, else the check-in's period (a legacy row). */
  dates: string[];
  /** The week's workouts in calendar order — the review read's own rows. */
  workouts: CheckInTrainingEventDetail[];
  highlights: CheckInExerciseHighlight[];
  /**
   * The nutrition kernel's figures and the week's food rows as the check-in
   * froze them, off the detail wire. `null` on a legacy row whose period
   * cannot be resolved: the grid shows the week's training alone.
   */
  nutrition: Nutrition | null;
};

// Room above the week's largest intake or target, so a bar never runs to the
// end of its track.
const BAR_HEADROOM = 1.08;
// The Day column stays put while the rest scroll under it on a narrow card —
// the logged-workout table's pinned first column.
const PINNED_CELL = "sticky left-0 z-[1] bg-white";
const PINNED_ROW_HOVER = "group-hover/row:bg-[#f8fcfb]";
// A day's line: every row stands at least this tall inside the table's own
// cell padding, so a single-line day reads with room (owner, 2026-09-29: "the
// rows are way too thin"). Set on the Day cell's content — the primitive's
// padding is never restyled (docs/newdesignsystem.md → Table) — and a day with
// two workouts grows past it.
const DAY_LINE = "flex min-h-[44px] items-center";

// Only what a glance can't read off the rows themselves: every day names its
// own standing in words (owner, 2026-09-29).
const LEGEND = [
  { swatch: cn("h-3 w-[2px] rounded-full", TARGET_TICK), label: "Day's target" },
  { swatch: cn("h-2.5 w-3 rounded-[2px]", MACRO_MARK.under.tint), label: "10%+ under" },
  { swatch: cn("h-2.5 w-3 rounded-[2px]", MACRO_MARK.over.tint), label: "10%+ over" },
];

/**
 * The week's calories, drawn like a day's: the intake on the targeted days
 * against every targeted day's target, a bar with a tick at that target, in the
 * week's own colour. These are the figures the week's word judges — a
 * targeted day with no food counts its whole target against the week — so the
 * bar beside them never reads fuller than its word.
 */
function WeekCalories({ nutrition }: { nutrition: Nutrition }) {
  const { targetTotals, consumedOnTargetedDays, periodVerdict } = nutrition;
  // The coach prescribed nothing all week: no total, no bar — never 0 of 0.
  if (!targetTotals || !consumedOnTargetedDays) return <span className="text-[12px] text-[#93b0b4]">No target set</span>;
  const scale = Math.max(consumedOnTargetedDays.calories, targetTotals.calories, 1) * BAR_HEADROOM;
  return (
    <CaloriesCell
      eaten={consumedOnTargetedDays.calories}
      target={targetTotals.calories}
      status={periodVerdict ?? "no_target"}
      scale={scale}
    />
  );
}

/** Per JUDGED day on both sides; with no judged day, what they ate per logged day, named so. */
function WeekAverage({ nutrition }: { nutrition: Nutrition }) {
  const { perJudgedDay, intakePerLoggedDay } = nutrition;
  if (!perJudgedDay && !intakePerLoggedDay) return <Dash />;
  return (
    <span className="whitespace-nowrap">
      <EatenOverTarget
        eaten={(perJudgedDay?.consumed.calories ?? intakePerLoggedDay!.calories).toLocaleString()}
        target={perJudgedDay ? perJudgedDay.target.calories.toLocaleString() : null}
        strong
      />
      <span className={cn(MONO_CELL_CLASS, TEXT_MUTED)}>{perJudgedDay ? " kcal avg / day" : " kcal avg / logged day"}</span>
    </span>
  );
}

/**
 * The check-in's week, one line per day (owner, 2026-09-29): the day, its
 * workouts, its calories and macros each over that day's own target, and the
 * day's word; the week's row under them carries the calorie total against its
 * target drawn like a day's, with the week's word, and the averages. Every nutrition figure is a frozen row from the
 * check-in's copy, worded from its own standing; the grid takes no log rows
 * and counts nothing — the week's total, its word and the averages are the
 * kernel's.
 */
export function WeekGrid({ dates, workouts, highlights, nutrition }: WeekGridProps) {
  const { preference } = useUnits();
  if (dates.length === 0) return null;

  const byDate = new Map((nutrition?.days ?? []).map((day) => [day.date, day]));
  const scale =
    Math.max(1, ...(nutrition?.days ?? []).map((day) => Math.max(day.actualCalories ?? 0, day.targetCalories ?? 0))) *
    BAR_HEADROOM;
  const onDay = (date: string) => workouts.filter((workout) => workout.date === date);
  const prHighlights = highlights.filter((highlight) => highlight.highlightType === "pr");

  return (
    <div>
      {/* The legend rides the rail's right side, as the Overview's adherence
          card's does — inside the card it left an empty band over the table. */}
      <SectionLabel
        label="Day by day"
        actions={
          nutrition && (
            <div data-legend="" className="flex items-center gap-3">
              {LEGEND.map((item) => (
                <span key={item.label} className="flex items-center gap-1.5">
                  <span className={cn("shrink-0", item.swatch)} aria-hidden />
                  {/* Passive legend words stay normal-case muted sans (divider grammar). */}
                  <span className="whitespace-nowrap text-[10px] text-[#93b0b4]">{item.label}</span>
                </span>
              ))}
            </div>
          )
        }
      />
      <div className="rounded-[6px] bg-white px-5 pb-3 pt-2">

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(PINNED_CELL, "pl-0")}>Day</TableHead>
              <TableHead>Training</TableHead>
              {nutrition && (
                <>
                  <TableHead>Calories (kcal)</TableHead>
                  {MACROS.map((macro) => (
                    <TableHead key={macro.name}>{macro.name} (g)</TableHead>
                  ))}
                  <TableHead className="pr-0">Nutrition</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {dates.map((date) => {
              const day = byDate.get(date) ?? null;
              return (
                <TableRow key={date} data-day={date} className="group/row">
                  <TableCell data-col="day" className={cn(PINNED_CELL, PINNED_ROW_HOVER, "pl-0")}>
                    <span className={DAY_LINE}>
                      <span className="flex items-baseline gap-2">
                        <span className={LABEL_CLASS}>{dayLabel(date)}</span>
                        <span className={cn(MONO, "text-[13px] font-medium", TEXT_PRIMARY)}>{dayOfMonth(date)}</span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell data-col="training">
                    <TrainingCell date={date} workouts={onDay(date)} />
                  </TableCell>
                  {nutrition && (
                    <>
                      <TableCell data-col="calories">
                        {day ? (
                          <CaloriesCell eaten={day.actualCalories} target={day.targetCalories} status={day.status} scale={scale} />
                        ) : (
                          <Dash />
                        )}
                      </TableCell>
                      {MACROS.map((macro) => (
                        <TableCell key={macro.name} data-col={macro.name.toLowerCase()}>
                          {day ? <MacroCell eaten={day[macro.eaten]} target={day[macro.target]} /> : <Dash />}
                        </TableCell>
                      ))}
                      <TableCell data-col="nutrition" className="pr-0">
                        {day ? <StandingCell status={day.status} /> : <Dash />}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
          {nutrition && (
            <TableFooter>
              <TableRow data-week="" className="hover:bg-transparent">
                <TableCell data-col="day" className={cn(PINNED_CELL, "pl-0 text-[13px] font-semibold text-[#0c1a1e]")}>
                  <span className={DAY_LINE}>Week</span>
                </TableCell>
                {/* The day's calorie average where Training sits (owner, 2026-09-29):
                    the calorie column carries the week drawn like a day. */}
                <TableCell data-col="training">
                  <WeekAverage nutrition={nutrition} />
                </TableCell>
                <TableCell data-col="calories">
                  <WeekCalories nutrition={nutrition} />
                </TableCell>
                {MACROS.map((macro) => (
                  <TableCell key={macro.name} data-col={macro.name.toLowerCase()}>
                    {nutrition.perJudgedDay ? (
                      <MacroCell
                        eaten={nutrition.perJudgedDay.consumed[macro.average]}
                        target={nutrition.perJudgedDay.target[macro.average]}
                        strong
                      />
                    ) : nutrition.intakePerLoggedDay ? (
                      <MacroCell eaten={nutrition.intakePerLoggedDay[macro.average]} target={null} strong />
                    ) : (
                      <Dash />
                    )}
                  </TableCell>
                ))}
                {/* The week's word: the kernel's verdict on the week's total, as a
                    day's word sits at the end of its line. */}
                <TableCell data-col="nutrition" className="pr-0">
                  <StandingCell status={nutrition.periodVerdict ?? "no_target"} />
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>

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
      </div>
    </div>
  );
}
