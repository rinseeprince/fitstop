import { describe, it, expect } from "vitest";
import { choiceDraft, choiceKey, newHabitDraft, readAddBatch, type NewHabitDraft } from "./add-habits-draft";
import type { HabitChoice } from "@/types/habits";

const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const water: HabitChoice = {
  name: "Water",
  howTo: "A glass with each meal",
  measure: "number",
  unit: "L",
  direction: "at_least",
  target: 3,
  timesPerWeek: null,
  weekdays: [...EVERY_DAY],
  words: { schedule: "Every day", target: "at least 3 L" },
};
const mobility: HabitChoice = {
  name: "Mobility",
  howTo: null,
  measure: "tick",
  unit: null,
  direction: null,
  target: null,
  timesPerWeek: null,
  weekdays: ["monday", "wednesday", "friday"],
  words: { schedule: "Mon, Wed, Fri", target: null },
};

const typed = (over: Partial<NewHabitDraft> = {}): NewHabitDraft => ({ ...newHabitDraft(1), ...over });

describe("choiceKey — tells the listed habits apart", () => {
  // The function already answers one row per name and way of measuring; the
  // key reads each row exactly as it came and never re-spells that grouping.
  it("is the same for the same row, and differs by any of the four fields, as written", () => {
    expect(choiceKey(water)).toBe(choiceKey({ ...water }));
    expect(choiceKey(water)).not.toBe(choiceKey({ ...water, name: "Water intake" }));
    expect(choiceKey(water)).not.toBe(choiceKey({ ...water, direction: "at_most" }));
    expect(choiceKey(water)).not.toBe(choiceKey({ ...water, unit: "cups" }));
    expect(choiceKey(water)).not.toBe(choiceKey({ ...water, measure: "tick", unit: null, direction: null }));
  });

  it("folds no case and trims nothing: two rows spelt apart keep two keys", () => {
    expect(choiceKey(water)).not.toBe(choiceKey({ ...water, name: "water" }));
    expect(choiceKey(water)).not.toBe(choiceKey({ ...water, unit: "l" }));
    expect(choiceKey(water)).not.toBe(choiceKey({ ...water, name: " Water " }));
  });

  // A name holding the key's own separator never makes two rows one.
  it("keeps the fields apart whatever they hold", () => {
    expect(choiceKey({ ...water, name: "Water|number", unit: "L" })).not.toBe(choiceKey({ ...water, name: "Water", unit: "number|L" }));
  });
});

describe("choiceDraft — a reused habit as it arrives", () => {
  it("brings its newest version's how-to, days and target", () => {
    expect(choiceDraft(water)).toEqual({ howTo: "A glass with each meal", schedule: { mode: "every", weekdays: [...EVERY_DAY], timesPerWeek: 3, target: "3" } });
    expect(choiceDraft(mobility)).toMatchObject({ howTo: "", schedule: { mode: "set", weekdays: ["monday", "wednesday", "friday"] } });
  });
});

describe("readAddBatch — the habits one save adds", () => {
  it("adds the picked habits as they arrive or adjusted, then the new ones, in order", () => {
    const adjusted = { ...choiceDraft(water), schedule: { ...choiceDraft(water).schedule, target: "2.5" } };
    const read = readAddBatch(
      [
        { choice: water, draft: adjusted },
        { choice: mobility, draft: choiceDraft(mobility) },
      ],
      [typed({ name: " Sauna ", schedule: { mode: "weekly", weekdays: [], timesPerWeek: 3, target: "" } })]
    );
    expect(read).toEqual({
      habits: [
        { name: "Water", howTo: "A glass with each meal", measure: "number", unit: "L", direction: "at_least", target: 2.5, weekdays: [...EVERY_DAY] },
        { name: "Mobility", howTo: null, measure: "tick", unit: null, direction: null, target: null, weekdays: ["monday", "wednesday", "friday"] },
        { name: "Sauna", howTo: null, measure: "tick", unit: null, direction: null, target: null, timesPerWeek: 3 },
      ],
    });
  });

  it("gives a new number habit its unit, direction and target, and a new tick habit none of them", () => {
    const read = readAddBatch(
      [],
      [
        typed({ name: "Drinks", measure: "number", unit: " drinks ", direction: "at_most", schedule: { ...newHabitDraft(1).schedule, target: "2" } }),
        typed({ name: "Walk", unit: "km", direction: "at_most" }),
      ]
    );
    expect(read).toEqual({
      habits: [
        { name: "Drinks", howTo: null, measure: "number", unit: "drinks", direction: "at_most", target: 2, weekdays: [...EVERY_DAY] },
        { name: "Walk", howTo: null, measure: "tick", unit: null, direction: null, target: null, weekdays: [...EVERY_DAY] },
      ],
    });
  });

  it("names the habit that cannot be saved, and why", () => {
    expect(readAddBatch([{ choice: water, draft: { ...choiceDraft(water), schedule: { ...choiceDraft(water).schedule, target: "" } } }], [])).toEqual({
      error: "Water: Enter a target",
    });
    expect(readAddBatch([], [typed({ name: "Stretch", schedule: { mode: "set", weekdays: [], timesPerWeek: 3, target: "" } })])).toEqual({
      error: "Stretch: Pick at least one day",
    });
    expect(readAddBatch([], [typed({ name: "  " })])).toEqual({ error: "Name the new habit" });
  });

  it("adds nothing with nothing picked or typed", () => {
    expect(readAddBatch([], [])).toEqual({ error: "Pick a habit or add a new one" });
  });
});
