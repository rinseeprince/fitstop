import { parseHabitAmount } from "@/lib/habits/habit-amount";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { DayOfWeek } from "@/types/check-in";
import type { HabitSchedule } from "@/hooks/use-client-habits";
import type { HabitMeasure, HabitVersion } from "@/types/habits";

/**
 * A habit's days and target as a form holds them while the coach edits:
 * every day, chosen weekdays (the weekday toggle row) or N times a week, and
 * the Target box's text. Shared by the Add habits sheet, Change target or
 * days and Start again, so the three read a schedule the same way.
 */
export type DaysMode = "every" | "set" | "weekly";

export type ScheduleDraft = {
  mode: DaysMode;
  /** The chosen weekdays, kept while another mode is picked so a switch back restores them. */
  weekdays: DayOfWeek[];
  timesPerWeek: number;
  /** The Target box as typed: a number habit's; empty on a tick habit. */
  target: string;
};

/** The times a week a draft offers until the coach picks: the plan's example, "3 times a week". */
const DEFAULT_TIMES_PER_WEEK = 3;

/**
 * A draft seeded from a version's days and target — the habit's running or
 * last version, or a reused habit's newest — or, with none, every day and an
 * empty Target box.
 */
export function draftFromVersion(version: Pick<HabitVersion, "target" | "timesPerWeek" | "weekdays"> | null): ScheduleDraft {
  const target = version?.target == null ? "" : String(version.target);
  if (!version) return { mode: "every", weekdays: [...DAYS_OF_WEEK], timesPerWeek: DEFAULT_TIMES_PER_WEEK, target };
  if (version.timesPerWeek !== null) {
    return { mode: "weekly", weekdays: [...DAYS_OF_WEEK], timesPerWeek: version.timesPerWeek, target };
  }
  const everyDay = DAYS_OF_WEEK.every((day) => version.weekdays.includes(day));
  return {
    mode: everyDay ? "every" : "set",
    weekdays: [...version.weekdays],
    timesPerWeek: DEFAULT_TIMES_PER_WEEK,
    target,
  };
}

/**
 * What a draft asks for: its days — every day is all seven weekdays — and a
 * number habit's target, read as typed; or why it cannot be saved, in words.
 */
export function readScheduleDraft(
  measure: HabitMeasure,
  draft: ScheduleDraft
): { schedule: HabitSchedule; target: number | null } | { error: string } {
  let schedule: HabitSchedule;
  if (draft.mode === "every") schedule = { weekdays: [...DAYS_OF_WEEK] };
  else if (draft.mode === "weekly") schedule = { timesPerWeek: draft.timesPerWeek };
  else if (draft.weekdays.length === 0) return { error: "Pick at least one day" };
  else schedule = { weekdays: DAYS_OF_WEEK.filter((day) => draft.weekdays.includes(day)) };

  if (measure === "tick") return { schedule, target: null };
  // A number habit always has a target (rule 1): an empty box is its own sentence.
  if (draft.target.trim() === "") return { error: "Enter a target" };
  const target = parseHabitAmount(draft.target);
  if ("error" in target) return { error: target.error };
  return { schedule, target: target.value };
}
