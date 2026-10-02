import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import { SHORT_WEEKDAY } from "@/lib/date-helpers";
import type { HabitDirection, HabitMeasure, HabitVersion, HabitWeekFigures, HabitWords } from "@/types/habits";

/**
 * The words every screen describes a habit in (docs/HABITS-REBUILD-PLAN.md
 * §2.3), spelled once: a schedule ("Every day", "Mon, Wed, Fri", "3 times a
 * week"), a target ("at least 3 L", "at most 2 drinks"), a week's figure
 * ("2 of 3"), and a change from one version to the next ("at least 3 L" →
 * "at least 4 L"). A unit is the coach's word, shown as typed and never
 * converted.
 */

/** When a version runs: every day, its weekdays Monday first, or its times a week. */
export function scheduleWords(version: Pick<HabitVersion, "timesPerWeek" | "weekdays">): string {
  if (version.timesPerWeek !== null) {
    if (version.timesPerWeek === 1) return "Once a week";
    if (version.timesPerWeek === 2) return "Twice a week";
    return `${version.timesPerWeek} times a week`;
  }
  const days = DAYS_OF_WEEK.filter((day) => version.weekdays.includes(day));
  if (days.length === DAYS_OF_WEEK.length) return "Every day";
  return days.map((day) => SHORT_WEEKDAY[day]).join(", ");
}

/** A habit's number as it reads: "6,000", "2.5", "3". */
export function habitNumber(value: number): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

/** A number habit's direction as the label of its Target box reads it: "At least", "At most". */
export function directionLabel(direction: HabitDirection | null): string {
  return direction === "at_most" ? "At most" : "At least";
}

/** A number in the habit's own unit, the coach's word: "6,000 steps", "2.5 L", "3" with no unit. */
export function habitAmount(habit: { unit: string | null }, value: number): string {
  return habit.unit ? `${habitNumber(value)} ${habit.unit}` : habitNumber(value);
}

/** A number habit's target in its direction and unit; null on a tick habit or with no target. */
export function targetWords(
  habit: { measure: HabitMeasure; unit: string | null; direction: HabitDirection | null },
  target: number | null
): string | null {
  if (habit.measure !== "number" || target === null || habit.direction === null) return null;
  return `${habit.direction === "at_most" ? "at most" : "at least"} ${habitAmount(habit, target)}`;
}

/** A week's figure: met of planned, or that nothing was planned. */
export function weekFigureWords(figures: HabitWeekFigures): string {
  return figures.planned === 0 ? "Nothing planned" : `${figures.met} of ${figures.planned}`;
}

/**
 * A figure as the coach's screens write it, a count over the planned —
 * "8/13": a week's met over its planned, or today's habits done today over
 * those planned today. Null when nothing was planned, whatever was done.
 */
export function figureFraction(count: number, planned: number): string | null {
  return planned === 0 ? null : `${count}/${planned}`;
}

/** A week's figure as a whole percentage, met over planned; null when nothing was planned. */
export function weekFigurePercent<F extends Pick<HabitWeekFigures, "met" | "planned">>(figures: F): number | null {
  return figures.planned === 0 ? null : Math.round((figures.met / figures.planned) * 100);
}

/** A habit's words on one line, its days then its target ("Every day · at least 3 L"); null with neither. */
export function wordsLine(words: HabitWords): string | null {
  const parts = [words.schedule, words.target].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

type VersionWorded = Pick<HabitVersion, "timesPerWeek" | "weekdays" | "target">;

/**
 * A change from one version to the next, in words: what changed — its days,
 * its target, or both, days first — as it read before and after ("at least
 * 8,000 steps" → "at least 10,000 steps", "3 times a week" → "Mon, Wed,
 * Fri"); null when neither did.
 */
export function changeWords(
  habit: { measure: HabitMeasure; unit: string | null; direction: HabitDirection | null },
  before: VersionWorded,
  after: VersionWorded
): { from: string; to: string } | null {
  const was = habitWords(habit, before);
  const now = habitWords(habit, after);
  // Each side's words with what stayed left out.
  const changed = (words: HabitWords): HabitWords => ({
    schedule: was.schedule !== now.schedule ? words.schedule : null,
    target: was.target !== now.target ? words.target : null,
  });
  const from = wordsLine(changed(was));
  const to = wordsLine(changed(now));
  return from === null || to === null ? null : { from, to };
}

/** A habit's words from a version: its schedule and its target — the day's when given, else the version's. */
export function habitWords(
  habit: { measure: HabitMeasure; unit: string | null; direction: HabitDirection | null },
  version: Pick<HabitVersion, "timesPerWeek" | "weekdays" | "target"> | null,
  target: number | null = version?.target ?? null
): HabitWords {
  return {
    schedule: version ? scheduleWords(version) : null,
    target: targetWords(habit, target),
  };
}
