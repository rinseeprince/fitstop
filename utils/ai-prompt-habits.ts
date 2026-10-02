import { sanitizeForAIPrompt } from "./ai-prompt-sanitizer";
import { HABIT_FIGURE_LABEL, habitFigure } from "@/lib/check-in/review-figures";
import { entryRecordsSomething, habitSectionRows } from "@/lib/check-in/habit-section-rows";
import { isWeeklyVersion, versionOn } from "@/lib/habits/habit-day";
import { habitAmount, targetWords } from "@/lib/habits/habit-words";
import { AI_PROMPT_TEXT_LIMIT } from "@/lib/constants";
import type { CheckInReviewInput } from "@/types/check-in-review-input";
import type { SentHabitWeek } from "@/lib/check-in/sent-snapshot";

/**
 * The check-in's habit week as the AI reads it (docs/HABITS-REBUILD-PLAN.md
 * §6, commit 6), from the copy the check-in froze, over the habits the review's
 * Habits section lists (`habitIsListed`) and in its words: the week's lines —
 * each habit's days and target as they stood, its figure and a number habit's
 * average — and each day's line — every habit planned that day or entered on
 * it, the entry against that day's target, met or not, and the client's note.
 * Nothing here counts an entry: every figure is the section's own.
 */

const text = (value: string) => sanitizeForAIPrompt(value, AI_PROMPT_TEXT_LIMIT);

/** One habit on one day of the week the check-in froze. */
export type ReviewDayHabit = {
  name: string;
  /** Planned that day, not planned, or a habit done N times a week, which plans no day: the Habits section's words. */
  plan: "planned" | "not planned" | "any day of the week";
  /** That day's target in words, "at least 3 L"; null on a tick habit. */
  target: string | null;
  /** The entry against the day's target: "done", "not done", "2.1 L, not met", "nothing entered". */
  entry: string;
  /** The day's entry met its target. */
  met: boolean;
  note: string | null;
};

type SentHabit = SentHabitWeek["habits"][number];

/** A day's entry in words: a tick habit done or not; a number habit's number, met or not, or nothing entered. */
function entryWords(habit: SentHabit, day: SentHabit["days"][number]): string {
  if (habit.measure === "tick") return day.entry?.done === true ? "done" : "not done";
  const value = day.entry?.value ?? null;
  if (value === null) return "nothing entered";
  return `${habitAmount(habit, value)}, ${day.met ? "met" : "not met"}`;
}

/**
 * A day's habits from the habit week the check-in froze: each habit planned
 * that day, or recorded on it though not planned — a habit made up on another
 * day than its plan, and a habit done N times a week on the days it was done —
 * with that day's target, the entry against it, whether it met it, and the
 * client's note. A day a habit was not running, and an unplanned day nothing
 * was recorded on (`entryRecordsSomething`: an untick with no note records
 * nothing), say nothing about it — so each habit named is one the review's
 * Habits section lists (`habitIsListed`).
 */
export function habitsOnDay(habitWeek: SentHabitWeek | null, date: string): ReviewDayHabit[] {
  return (habitWeek?.habits ?? []).flatMap((habit) => {
    const day = habit.days.find((candidate) => candidate.date === date);
    if (!day?.covered || (!day.planned && !entryRecordsSomething(day.entry))) return [];
    const version = versionOn(habit, date);
    return [
      {
        name: habit.name,
        plan: version && isWeeklyVersion(version) ? "any day of the week" : day.planned ? "planned" : "not planned",
        target: targetWords(habit, day.target),
        entry: entryWords(habit, day),
        met: day.met,
        note: day.entry?.note ?? null,
      },
    ];
  });
}

/** One habit on its day: `Water (planned, at least 3 L): 2.1 L, not met, note "Travelling"`. */
export function habitOnDay(habit: ReviewDayHabit): string {
  const about = [habit.plan, habit.target === null ? null : text(habit.target)].filter((part) => part !== null);
  const note = habit.note ? `, note "${text(habit.note)}"` : "";
  return `${text(habit.name)} (${about.join(", ")}): ${text(habit.entry)}${note}`;
}

/**
 * The week's habits as the review's Habits section shows them — its rows, in
 * its words: the habit days met over the days planned, then each habit with
 * its days and its target as they stood, its met of its planned (or nothing
 * planned) and, for a number habit, its average. Nothing when the section
 * lists no habit.
 */
export function habitWeekLines(habitWeek: CheckInReviewInput["habitWeek"]): string[] {
  const rows = habitSectionRows(habitWeek);
  if (rows.length === 0 || !habitWeek) return [];
  const total = habitFigure(habitWeek.totals);
  return [
    total ? `Habits: ${total.fraction} ${HABIT_FIGURE_LABEL}` : "Habits: nothing planned this week",
    ...rows.map((row) => {
      const words = row.words ? ` (${text(row.words)})` : "";
      const figure = row.figure ? `${row.figure} days done` : "nothing planned";
      const average = row.average ? `, ${text(row.average)}` : "";
      return `  ${text(row.name)}${words}: ${figure}${average}`;
    }),
  ];
}
