"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  MONO,
  MONO_CELL_CLASS,
  MONO_META_CLASS,
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
  sharedTarget,
} from "./week-grid-words";

type Nutrition = CheckInPeriodAdherence["nutrition"];
/** The week's frozen food rows, one per column; null for a day the copy holds none of. */
type Food = (NutritionDay | null)[];

// Room above the week's tallest bar or target, so the top of the chart never
// clips a line.
const BAR_HEADROOM = 1.08;

const Dash = () => <span className="text-[#c2d0cc]">—</span>;

/** One row of the grid: a label, one cell per day, the average on the right — every row on one template. */
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
  average: ReactNode;
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
      <div data-average="" className={cn("flex flex-col items-center justify-center bg-[rgba(13,148,136,0.03)]", padding)}>
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

/** Each workout under its own day, its name and its word off its log; the average is the page's one count. */
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
      average={
        planned === 0 ? (
          <Dash />
        ) : (
          <span className={cn(MONO, "text-[14px] font-semibold", TEXT_PRIMARY)}>
            {training.completed}/{planned}
          </span>
        )
      }
    />
  );
}

/** Each day's eaten figure over its bar, a line at its target, and the word the check-in froze under it. */
export function CaloriesRow({ template, dates, food, nutrition }: { template: CSSProperties; dates: string[]; food: Food; nutrition: Nutrition }) {
  const scale =
    Math.max(1, ...food.map((day) => Math.max(day?.actualCalories ?? 0, day?.targetCalories ?? 0))) * BAR_HEADROOM;
  const height = (value: number) => `${Math.min(value / scale, 1) * 100}%`;
  const target = sharedTarget(food.map((day) => day?.targetCalories ?? null));
  const anyTarget = food.some((day) => day?.targetCalories != null);
  const sub = target != null ? `Target ${target.toLocaleString()}` : anyTarget ? "Target varies by day" : "No target set";
  const perDay = nutrition.perJudgedDay?.consumed.calories ?? nutrition.intakePerLoggedDay?.calories ?? null;

  return (
    <GridRow
      name="calories"
      template={template}
      padding="py-3"
      label={<RowLabel title="Calories" sub={sub} numeric={target != null} />}
      cells={dates.map((date, i) => {
        const day = food[i];
        if (!day) return { date, cell: <Dash /> };
        const standing = DAY_STANDING[day.status];
        return {
          date,
          cell: (
            <div className="flex w-full flex-col items-center gap-1.5">
              <span className={cn(MONO, "text-[12px] font-semibold", standing.figure)}>
                {day.actualCalories == null ? <Dash /> : day.actualCalories.toLocaleString()}
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
        perDay == null ? (
          <Dash />
        ) : (
          <>
            <span className={cn(MONO, "text-[15px] font-semibold", TEXT_PRIMARY)}>{perDay.toLocaleString()}</span>
            {/* Per JUDGED day — intake against a target covers the same days;
                with no judged day, what they ate per logged day, named so. */}
            <span className="mt-0.5 text-[10px] text-[#93b0b4]">
              {nutrition.perJudgedDay ? "kcal / day" : "kcal / logged day"}
            </span>
          </>
        )
      }
    />
  );
}

function MacroFigure({ eaten, target, strong }: { eaten: number | null; target: number | null; strong?: boolean }) {
  if (eaten == null) return <Dash />;
  const mark = macroMark(eaten, target);
  return (
    <span
      title={target == null ? undefined : `Target ${target}g${mark ? `, ${MACRO_MARK[mark].words}` : ""}`}
      className={cn(MONO_CELL_CLASS, "rounded-[4px] px-1.5 py-0.5", strong && "font-semibold", mark ? MACRO_MARK[mark].tint : TEXT_PRIMARY)}
    >
      {eaten}
      {mark && <span className="sr-only">, {MACRO_MARK[mark].words}</span>}
    </span>
  );
}

/** Each day's grams of one macro, tinted 10% or more off that day's target; the average per judged day. */
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
  const target = sharedTarget(food.map((day) => day?.[macro.target] ?? null));
  const anyTarget = food.some((day) => day?.[macro.target] != null);
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
          {target != null ? (
            <span className={cn(MONO_META_CLASS, "text-[11px]")}>{target}g</span>
          ) : (
            anyTarget && <span className="text-[11px] text-[#93b0b4]">varies</span>
          )}
        </span>
      }
      cells={dates.map((date, i) => {
        const day = food[i];
        return { date, cell: day ? <MacroFigure eaten={day[macro.eaten]} target={day[macro.target]} /> : <Dash /> };
      })}
      average={
        perJudgedDay ? (
          <MacroFigure eaten={perJudgedDay.consumed[macro.average]} target={perJudgedDay.target[macro.average]} strong />
        ) : intakePerLoggedDay ? (
          <MacroFigure eaten={intakePerLoggedDay[macro.average]} target={null} strong />
        ) : (
          <Dash />
        )
      }
    />
  );
}
