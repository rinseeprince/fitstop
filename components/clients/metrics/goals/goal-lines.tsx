"use client";

import { cn } from "@/lib/utils";
import {
  MONO,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { describeBuilt } from "@/components/clients/nutrition/nutrition-out-of-date-notice";
import { formatHistoryDate } from "@/lib/date-helpers";
import { GOAL_TYPE_SETTINGS, type GoalType } from "@/lib/goals/goal-types";
import { wordsLine } from "@/lib/habits/habit-words";
import type { UnitSystem } from "@/utils/unit-conversions";
import type { GoalHistoryLine } from "@/types/client-goals";
import type { HabitWords } from "@/types/habits";

/**
 * An opened goal's lines, oldest first: each dated by the day it takes effect
 * (a nutrition version by its window), then what it is and what happened. A
 * deadline change's dates are data, so mono, and its "none" a word, so sans;
 * the other lines weave words and numbers, so they are sentences, all sans
 * (docs/newdesignsystem.md → Prose vs data). A habit's line reads in the
 * present, as a program's does, so a change dated ahead reads true.
 */

function DeadlineSide({ day }: { day: string | null }) {
  return day ? <span className={MONO}>{formatHistoryDate(day)}</span> : <span>none</span>;
}

/** What happened, then the habit's days and target from that day: "Water starts · Every day · at least 3 L". */
const withWords = (happened: string, words: HabitWords) => [happened, wordsLine(words)].filter(Boolean).join(" · ");

function habitDetail(line: Extract<GoalHistoryLine, { kind: "habit" }>): string {
  switch (line.change) {
    case "added":
      return withWords(`${line.name} starts`, line.words);
    case "started_again":
      return withWords(`${line.name} starts again`, line.words);
    case "changed":
      return `${line.name} changes · ${line.from} → ${line.to}`;
    case "stopped":
      return `${line.name} stops`;
  }
}

function Detail({ line, viewer }: { line: GoalHistoryLine; viewer: UnitSystem }) {
  switch (line.kind) {
    case "deadline":
      return (
        <span className={TEXT_PRIMARY}>
          <DeadlineSide day={line.from} /> → <DeadlineSide day={line.to} />
        </span>
      );
    case "nutrition":
      return (
        <span className={TEXT_PRIMARY}>
          {`${Math.round(line.calories).toLocaleString()} kcal, built for ${describeBuilt(line.builtFor, viewer)}`}
        </span>
      );
    case "program":
      return (
        <span className={TEXT_PRIMARY}>
          {line.change === "replaces" ? `${line.name} replaces ${line.replaced}` : `${line.name} ${line.change}`}
        </span>
      );
    case "habit":
      return <span className={TEXT_PRIMARY}>{habitDetail(line)}</span>;
  }
}

export function GoalLines({
  lines,
  type,
  viewer,
}: {
  lines: GoalHistoryLine[];
  /** The goal's type, which names its deadline. */
  type: GoalType;
  viewer: UnitSystem;
}) {
  if (lines.length === 0) {
    return <p className={cn("text-[12px]", TEXT_MUTED)}>No deadline, nutrition, program or habit changes.</p>;
  }

  const label: Record<GoalHistoryLine["kind"], string> = {
    deadline: GOAL_TYPE_SETTINGS[type].deadlineLabel,
    nutrition: "Nutrition",
    program: "Program",
    habit: "Habit",
  };

  // Three columns for the whole list, every line a subgrid over them, so the
  // dates, what each line is and what happened line up down the list.
  return (
    <ul className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
      {lines.map((line, i) => (
        <li key={`${line.kind}-${line.on}-${i}`} className="col-span-3 grid grid-cols-subgrid items-baseline">
          <span className={cn(MONO, TEXT_MUTED, "whitespace-nowrap")}>
            {line.kind === "nutrition" && line.until !== line.on
              ? `${formatHistoryDate(line.on)} – ${formatHistoryDate(line.until)}`
              : formatHistoryDate(line.on)}
          </span>
          <span className={TEXT_SECONDARY}>{label[line.kind]}</span>
          <Detail line={line} viewer={viewer} />
        </li>
      ))}
    </ul>
  );
}
