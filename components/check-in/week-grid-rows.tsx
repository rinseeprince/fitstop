"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  MONO,
  MONO_CELL_CLASS,
  MONO_META_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { trainingAdherenceStatus, type TrainingAdherence } from "@/lib/training-adherence";
import type { CheckInTrainingEventDetail } from "@/types/check-in";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";
import type { NutritionDay } from "@/types/schedule";
import {
  DAY_STANDING,
  MACROS,
  MACRO_MARK,
  NO_FOOD_BOX,
  TARGET_LINE,
  WORKOUT_STATUS,
  macroMark,
} from "./week-grid-words";

type Nutrition = CheckInPeriodAdherence["nutrition"];
/** The week's frozen food rows, one per column; null for a day the copy holds none of. */
type Food = (NutritionDay | null)[];

// Room above the week's tallest bar or target, so the top of the chart never
// clips a line.
const BAR_HEADROOM = 1.08;
// The average column's wash: it belongs to the nutrition rows alone.
const AVERAGE_WASH = "bg-[rgba(13,148,136,0.03)]";

const Dash = () => <span className="text-[#c2d0cc]">—</span>;

/**
 * A day's target, small and muted over what was eaten — the design system's
 * target-over-actual grammar. A held line (a non-breaking space) where no
 * target covered the day, so every eaten figure in a row sits on one baseline.
 */
function TargetLine({ value, unit = "" }: { value: number | null; unit?: string }) {
  return (
    <span className={cn(MONO, "block text-[11px] leading-[14px]", TEXT_MUTED)}>
      {value == null ? " " : `${value.toLocaleString()}${unit}`}
    </span>
  );
}

/**
 * One row of the grid: a label, one cell per day, and the average on the right
 * — every row on one template. A row with no average (Training) leaves the
 * column bare, so the wash covers the nutrition rows only.
 */
export function GridRow({
  name,
  template,
  label,
  cells,
  average,
  padding,
}: {
  name: string;
  template: CSSProperties;
  label: ReactNode;
  cells: { date: string; cell: ReactNode }[];
  average?: ReactNode;
  padding: string;
}) {
  return (
    <div
      data-row={name}
      className="grid border-b border-[rgba(13,148,136,0.06)] last:border-b-0"
      style={template}
    >
      <div className={cn("flex min-w-0 flex-col justify-center pr-3", padding)}>{label}</div>
      {cells.map(({ date, cell }) => (
        <div key={date} data-day={date} className={cn("flex min-w-0 flex-col items-center justify-center px-1", padding)}>
          {cell}
        </div>
      ))}
      <div
        data-average=""
        className={cn("flex flex-col items-center justify-center", average !== undefined && AVERAGE_WASH, padding)}
      >
        {average}
      </div>
    </div>
  );
}

function RowLabel({ title, sub, numeric }: { title: ReactNode; sub: string | null; numeric: boolean }) {
  return (
    <>
      <span className="text-[13px] font-semibold text-[#0c1a1e]">{title}</span>
      {sub && (
        <span className={cn("mt-0.5 text-[11px]", numeric ? MONO_META_CLASS : "text-[#93b0b4]")}>{sub}</span>
      )}
    </>
  );
}

/**
 * Each workout under its own day, its name and its word off its log. No
 * average: a week's training is its sessions, not a mean of them (owner,
 * 2026-09-29) — the ribbon above carries the count.
 */
export function TrainingRow({
  template,
  dates,
  workouts,
  training,
}: {
  template: CSSProperties;
  dates: string[];
  workouts: CheckInTrainingEventDetail[];
  training: TrainingAdherence;
}) {
  const onDay = (date: string) => workouts.filter((workout) => workout.date === date);
  const planned = training.planned;
  return (
    <GridRow
      name="training"
      template={template}
      padding="py-3"
      label={
        <RowLabel
          title="Training"
          sub={planned === 0 ? "No sessions planned" : `${planned} ${planned === 1 ? "session" : "sessions"} planned`}
          numeric={planned > 0}
        />
      }
      cells={dates.map((date) => {
        const day = onDay(date);
        return {
          date,
          cell:
            day.length === 0 ? (
              <Dash />
            ) : (
              // A day shows every workout on it, in the day's order.
              <div className="flex w-full flex-col gap-1">
                {day.map((workout) => {
                  const status = WORKOUT_STATUS[trainingAdherenceStatus(workout)];
                  const Icon = status.icon;
                  return (
                    <div key={workout.eventId} className={cn("rounded-[6px] px-2 py-1 text-center", status.chip)}>
                      <div className="truncate text-[11px] font-semibold text-[#0c1a1e]">
                        {workout.performedSessionName ?? workout.sessionName}
                      </div>
                      <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium">
                        <Icon className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                        {status.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            ),
        };
      })}
    />
  );
}

/**
 * The week's calories beside their bars: what was eaten on the targeted days
 * against every targeted day's target, and the bar — the kernel's figures, the
 * home they have beside the days they add up.
 */
function CaloriesLabel({ nutrition }: { nutrition: Nutrition }) {
  const { targetTotals, consumedOnTargetedDays } = nutrition;
  // The coach prescribed nothing all week: no total, no bar — never 0 of 0.
  if (!targetTotals || !consumedOnTargetedDays) return <RowLabel title="Calories" sub="No target set" numeric={false} />;
  const fill = targetTotals.calories > 0 ? Math.min((consumedOnTargetedDays.calories / targetTotals.calories) * 100, 100) : 0;
  return (
    <>
      <span className="text-[13px] font-semibold text-[#0c1a1e]">Calories</span>
      <span className={cn(MONO, "mt-1.5 text-[13px] font-semibold", TEXT_PRIMARY)}>
        {consumedOnTargetedDays.calories.toLocaleString()}
      </span>
      <span className={cn(MONO_META_CLASS, "text-[11px]")}>of {targetTotals.calories.toLocaleString()} kcal</span>
      <span className="mt-1.5 h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-[rgba(13,148,136,0.08)]" aria-hidden>
        <span className="block h-full rounded-full bg-[#0d9488]" style={{ width: `${fill}%` }} />
      </span>
    </>
  );
}

/**
 * Each day's target over what was eaten, the bar against a line at that day's
 * own target — a training day's surplus lifts its line — and the word the
 * check-in froze under it. The average column starts here.
 */
export function CaloriesRow({ template, dates, food, nutrition }: { template: CSSProperties; dates: string[]; food: Food; nutrition: Nutrition }) {
  const scale =
    Math.max(1, ...food.map((day) => Math.max(day?.actualCalories ?? 0, day?.targetCalories ?? 0))) * BAR_HEADROOM;
  const height = (value: number) => `${Math.min(value / scale, 1) * 100}%`;
  const { perJudgedDay, intakePerLoggedDay } = nutrition;
  const perDay = perJudgedDay?.consumed.calories ?? intakePerLoggedDay?.calories ?? null;

  return (
    <GridRow
      name="calories"
      template={template}
      padding="py-3"
      label={<CaloriesLabel nutrition={nutrition} />}
      cells={dates.map((date, i) => {
        const day = food[i];
        if (!day) return { date, cell: <Dash /> };
        const standing = DAY_STANDING[day.status];
        return {
          date,
          cell: (
            <div className="flex w-full flex-col items-center gap-1.5">
              <span className="flex flex-col items-center">
                <TargetLine value={day.targetCalories} />
                <span className={cn(MONO, "text-[12px] font-semibold leading-[18px]", standing.figure)}>
                  {day.actualCalories == null ? <Dash /> : day.actualCalories.toLocaleString()}
                </span>
              </span>
              <div className="relative h-[72px] w-full" aria-hidden>
                {day.targetCalories != null && (
                  <span
                    className={cn("absolute inset-x-2 h-[3px] -translate-y-1/2 rounded-full", TARGET_LINE)}
                    style={{ bottom: height(day.targetCalories) }}
                  />
                )}
                {day.actualCalories != null ? (
                  <span
                    className={cn("absolute bottom-0 left-1/2 w-7 -translate-x-1/2 rounded-t-[4px]", standing.bar)}
                    style={{ height: height(day.actualCalories) }}
                  />
                ) : (
                  <span className={cn("absolute bottom-0 left-1/2 h-4 w-7 -translate-x-1/2", NO_FOOD_BOX)} />
                )}
              </div>
              <span className={cn("rounded-[4px] px-1.5 py-0.5 text-center text-[10px] font-medium leading-tight", standing.pill)}>
                {standing.label}
              </span>
            </div>
          ),
        };
      })}
      average={
        <div className="flex h-full flex-col items-center">
          <span className={LABEL_CLASS}>Avg</span>
          <div className="flex flex-1 flex-col items-center justify-center">
            {perDay == null ? (
              <Dash />
            ) : (
              <>
                {/* Per JUDGED day on both sides — intake against a target
                    covers the same days; with no judged day, what they ate per
                    logged day, named so. */}
                <TargetLine value={perJudgedDay?.target.calories ?? null} />
                <span className={cn(MONO, "text-[15px] font-semibold", TEXT_PRIMARY)}>{perDay.toLocaleString()}</span>
                <span className="mt-0.5 text-[10px] text-[#93b0b4]">{perJudgedDay ? "kcal / day" : "kcal / logged day"}</span>
              </>
            )}
          </div>
        </div>
      }
    />
  );
}

/** A macro's target over what was eaten, the eaten figure tinted 10% or more off that target. */
function MacroCell({ eaten, target, strong }: { eaten: number | null; target: number | null; strong?: boolean }) {
  const mark = macroMark(eaten, target);
  return (
    <span className="flex flex-col items-center">
      <TargetLine value={target} unit="g" />
      {eaten == null ? (
        <span className="leading-[22px]">
          <Dash />
        </span>
      ) : (
        <span
          title={mark ? MACRO_MARK[mark].words : undefined}
          className={cn(
            MONO_CELL_CLASS,
            "rounded-[4px] px-1.5 leading-[22px]",
            strong && "font-semibold",
            mark ? MACRO_MARK[mark].tint : TEXT_PRIMARY
          )}
        >
          {eaten}
          {mark && <span className="sr-only">, {MACRO_MARK[mark].words}</span>}
        </span>
      )}
    </span>
  );
}

/** Each day's grams of one macro under that day's own target; the average per judged day. */
export function MacroRow({
  template,
  dates,
  food,
  nutrition,
  macro,
}: {
  template: CSSProperties;
  dates: string[];
  food: Food;
  nutrition: Nutrition;
  macro: (typeof MACROS)[number];
}) {
  const { perJudgedDay, intakePerLoggedDay } = nutrition;
  return (
    <GridRow
      name={macro.name.toLowerCase()}
      template={template}
      padding="py-2"
      label={
        <span className="flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-[2px]", macro.dot)} aria-hidden />
          <span className="text-[13px] font-semibold text-[#0c1a1e]">{macro.name}</span>
        </span>
      }
      cells={dates.map((date, i) => {
        const day = food[i];
        return { date, cell: day ? <MacroCell eaten={day[macro.eaten]} target={day[macro.target]} /> : <Dash /> };
      })}
      average={
        perJudgedDay ? (
          <MacroCell eaten={perJudgedDay.consumed[macro.average]} target={perJudgedDay.target[macro.average]} strong />
        ) : intakePerLoggedDay ? (
          <MacroCell eaten={intakePerLoggedDay[macro.average]} target={null} strong />
        ) : (
          <Dash />
        )
      }
    />
  );
}
