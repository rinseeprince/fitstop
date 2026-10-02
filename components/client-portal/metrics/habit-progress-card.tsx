"use client";

import {
  LABEL_CLASS,
  MONO,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "@/components/clients/training/program-builder/builder-tokens";
import { weekFigureWords, wordsLine } from "@/lib/habits/habit-words";
import { cn } from "@/lib/utils";
import { HabitWeekBars } from "./habit-week-bars";
import type { HabitProgressRow } from "@/types/habits";

/**
 * One habit on the Journey: its name and words (its days, then its target),
 * this week's figure — met of planned, a day made up on another day counted
 * toward its week — and its recent weeks as bars. Every figure is the
 * server's, on the client's calendar; none is added up here.
 */
export function HabitProgressCard({ row }: { row: HabitProgressRow }) {
  const { habit, words, weeks } = row;
  const thisWeek = weeks[weeks.length - 1] ?? null;
  const describe = wordsLine(words);
  const figure = thisWeek ? weekFigureWords(thisWeek) : "Nothing planned";

  return (
    <section aria-label={habit.name} className={cn("rounded-[6px] bg-white p-4", TRAINING_CARD_BORDER)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn("truncate text-[13.5px] font-semibold", TEXT_PRIMARY)}>{habit.name}</h3>
          {describe ? <p className={cn("mt-0.5 text-[12px]", TEXT_SECONDARY)}>{describe}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <p className={LABEL_CLASS}>This week</p>
          <p className={cn("mt-0.5 text-[15px] font-semibold", TEXT_PRIMARY, thisWeek && thisWeek.planned > 0 && MONO)}>{figure}</p>
        </div>
      </div>
      <div className="mt-4">
        <HabitWeekBars weeks={weeks} />
      </div>
    </section>
  );
}
