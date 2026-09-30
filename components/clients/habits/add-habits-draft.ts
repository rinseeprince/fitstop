import { draftFromVersion, readScheduleDraft, type ScheduleDraft } from "./habit-schedule-draft";
import type { NewHabit } from "@/hooks/use-client-habits";
import type { HabitChoice, HabitDirection, HabitMeasure } from "@/types/habits";

/**
 * What the Add habits sheet holds until its one save: the coach's habits
 * picked to give this client, each as it arrives or adjusted — its how-to,
 * days and target; how it is measured and its name are what make it the same
 * habit, so they come as they are — and the new habits typed in, in the order
 * added.
 */
export type ChoiceDraft = { howTo: string; schedule: ScheduleDraft };

export type NewHabitDraft = {
  /** Tells two new habits apart while both are being typed. */
  key: number;
  name: string;
  howTo: string;
  measure: HabitMeasure;
  unit: string;
  direction: HabitDirection;
  schedule: ScheduleDraft;
};

/**
 * Tells the habits the coach can reuse apart: its name and how it is
 * measured, exactly as the row reads. `coach_habit_choices` answers one row
 * per name and way of measuring, so no two rows share all four — and the key
 * never re-spells the function's own grouping, whose lower-casing a browser
 * does not always match.
 */
export function choiceKey(choice: Pick<HabitChoice, "name" | "measure" | "unit" | "direction">): string {
  return JSON.stringify([choice.name, choice.measure, choice.unit, choice.direction]);
}

/** A reused habit as it arrives: its newest version's how-to, days and target. */
export function choiceDraft(choice: HabitChoice): ChoiceDraft {
  return { howTo: choice.howTo ?? "", schedule: draftFromVersion(choice) };
}

/** A new habit as its card opens: ticked every day. */
export function newHabitDraft(key: number): NewHabitDraft {
  return { key, name: "", howTo: "", measure: "tick", unit: "", direction: "at_least", schedule: draftFromVersion(null) };
}

/**
 * The habits one save adds — the picked ones in the order they are listed,
 * then the new ones in the order added — or the first reason one cannot be
 * saved, naming it.
 */
export function readAddBatch(
  picked: { choice: HabitChoice; draft: ChoiceDraft }[],
  added: NewHabitDraft[]
): { habits: NewHabit[] } | { error: string } {
  const habits: NewHabit[] = [];
  for (const { choice, draft } of picked) {
    const read = readScheduleDraft(choice.measure, draft.schedule);
    if ("error" in read) return { error: `${choice.name}: ${read.error}` };
    habits.push({
      name: choice.name,
      howTo: draft.howTo.trim() || null,
      measure: choice.measure,
      unit: choice.unit,
      direction: choice.direction,
      target: read.target,
      ...read.schedule,
    });
  }
  for (const draft of added) {
    const name = draft.name.trim();
    if (!name) return { error: "Name the new habit" };
    const read = readScheduleDraft(draft.measure, draft.schedule);
    if ("error" in read) return { error: `${name}: ${read.error}` };
    const counted = draft.measure === "number";
    habits.push({
      name,
      howTo: draft.howTo.trim() || null,
      measure: draft.measure,
      unit: counted && draft.unit.trim() ? draft.unit.trim() : null,
      direction: counted ? draft.direction : null,
      target: read.target,
      ...read.schedule,
    });
  }
  if (habits.length === 0) return { error: "Pick a habit or add a new one" };
  return { habits };
}
