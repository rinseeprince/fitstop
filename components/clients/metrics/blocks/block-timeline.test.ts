import { describe, expect, it } from "vitest";
import { deriveTimelineEntries } from "./block-timeline";
import type { BlockNutritionFact } from "@/types/client-blocks";

const nutrition = (
  versions: { from: string; calories: number; deficitPerDay: number | null; note?: string }[]
): BlockNutritionFact[] =>
  versions.map((version, index) => ({
    id: `v${index + 1}`,
    startsOn: version.from,
    calories: version.calories,
    deficitPerDay: version.deficitPerDay,
    note: version.note ?? null,
  }));

const BLOCK = {
  id: "a",
  startsOn: "2026-06-01",
  endsOn: "2026-06-28",
};

const plan = (id: string, name: string, startsOn: string) => ({
  id,
  name,
  startsOn,
});

describe("deriveTimelineEntries", () => {
  it("current block: start entry + in-window placements, date-sorted", () => {
    const entries = deriveTimelineEntries(
      { ...BLOCK, state: "current" },
      [
        plan("p2", "Peak", "2026-06-15"),
        plan("p1", "Base", "2026-06-03"),
        // Overlaps the block but STARTED before it — a placement entry
        // belongs to the block whose window contains its start.
        plan("p0", "Prep", "2026-05-20"),
      ],
      []
    );
    expect(entries.map((e) => e.label)).toEqual([
      "Block started",
      "Base started",
      "Peak started",
    ]);
    expect(entries.map((e) => e.date)).toEqual([
      "2026-06-01",
      "2026-06-03",
      "2026-06-15",
    ]);
  });

  it("past block: appends the end entry", () => {
    const entries = deriveTimelineEntries({ ...BLOCK, state: "past" }, [], []);
    expect(entries.map((e) => e.label)).toEqual(["Block started", "Block ended"]);
  });

  it("future block with nothing placed: empty — the renderer says \"Nothing yet.\"", () => {
    expect(deriveTimelineEntries({ ...BLOCK, state: "future" }, [], [])).toEqual([]);
  });

  // The coach's first question reviewing a block: what were they eating, and
  // when did it change. Each era carries its OWN version's numbers, so a later
  // plan save cannot rewrite an entry that has already happened.
  describe("nutrition eras", () => {
    it("one era: 'Nutrition set' at the block start, with its numbers", () => {
      const entries = deriveTimelineEntries(
        { ...BLOCK, state: "current" },
        [],
        nutrition([{ from: "2026-06-01", calories: 3471, deficitPerDay: 629 }])
      );

      expect(entries.map((e) => e.label)).toEqual(["Block started", "Nutrition set"]);
      expect(entries[1].detail).toBe("3,471 kcal · −629 kcal/day");
    });

    it("a mid-block change gets its own dated entry, keeping the first", () => {
      const entries = deriveTimelineEntries(
        { ...BLOCK, state: "current" },
        [],
        nutrition([
          { from: "2026-06-01", calories: 3471, deficitPerDay: 629 },
          { from: "2026-06-15", calories: 3200, deficitPerDay: 900 },
        ])
      );

      expect(entries.map((e) => [e.date, e.label, e.detail])).toEqual([
        ["2026-06-01", "Block started", undefined],
        ["2026-06-01", "Nutrition set", "3,471 kcal · −629 kcal/day"],
        ["2026-06-15", "Nutrition changed", "3,200 kcal · −900 kcal/day"],
      ]);
    });

    it("a surplus reads as a plus, and no tdee drops the deficit half", () => {
      const entries = deriveTimelineEntries(
        { ...BLOCK, state: "current" },
        [],
        nutrition([
          { from: "2026-06-01", calories: 3000, deficitPerDay: -250 },
          { from: "2026-06-10", calories: 2800, deficitPerDay: null },
        ])
      );

      expect(entries[1].detail).toBe("3,000 kcal · +250 kcal/day");
      expect(entries[2].detail).toBe("2,800 kcal");
    });

    it("no nutrition version: the timeline is unchanged", () => {
      const entries = deriveTimelineEntries({ ...BLOCK, state: "current" }, [], []);
      expect(entries.map((e) => e.label)).toEqual(["Block started"]);
    });

    // A block that has not begun describes what is planned for it: a queued
    // prescription lists as "Nutrition set", as a queued program lists as
    // started. Only the block's own "started" entry waits for the day.
    it("future block: a queued prescription lists as 'Nutrition set' with its numbers", () => {
      const entries = deriveTimelineEntries(
        { ...BLOCK, state: "future" },
        [],
        nutrition([{ from: "2026-06-01", calories: 3471, deficitPerDay: 629 }])
      );
      expect(entries.map((e) => [e.date, e.label])).toEqual([["2026-06-01", "Nutrition set"]]);
      expect(entries[0].detail).toBe("3,471 kcal · −629 kcal/day");
    });
  });

  it("future block with a queued placement: the placement is the only entry", () => {
    const entries = deriveTimelineEntries(
      { ...BLOCK, state: "future" },
      [plan("p1", "Base", "2026-06-03")],
      []
    );
    expect(entries.map((e) => e.label)).toEqual(["Base started"]);
  });

  // A version's save note NESTS under its own entry — evidence for the change
  // above it, never a bullet of its own (migration 172: the note is a column
  // on the version, so there is nothing to attach and nothing to orphan).
  describe("coach notes (migration 172)", () => {
    it("nests a version's note under its entry, adding no entry", () => {
      const entries = deriveTimelineEntries(
        { ...BLOCK, state: "current" },
        [],
        nutrition([{ from: "2026-06-15", calories: 3200, deficitPerDay: 900, note: "Dropping calories 200." }])
      );

      expect(entries.map((e) => e.label)).toEqual(["Block started", "Nutrition set"]);
      expect(entries[1].note).toBe("Dropping calories 200.");
      expect(entries[0].note).toBeUndefined();
    });

    it("a version without a note carries none, and the entries are otherwise the same", () => {
      const withNote = deriveTimelineEntries(
        { ...BLOCK, state: "past" },
        [plan("p1", "Base", "2026-06-03")],
        nutrition([{ from: "2026-06-01", calories: 3471, deficitPerDay: 629, note: "first" }])
      );
      const without = deriveTimelineEntries(
        { ...BLOCK, state: "past" },
        [plan("p1", "Base", "2026-06-03")],
        nutrition([{ from: "2026-06-01", calories: 3471, deficitPerDay: 629 }])
      );

      expect(without.every((e) => e.note === undefined)).toBe(true);
      expect(without.map((e) => [e.date, e.label])).toEqual(withNote.map((e) => [e.date, e.label]));
    });

    it("a version that began before the block has no entry, so its note stays with it", () => {
      const entries = deriveTimelineEntries(
        { ...BLOCK, state: "current" },
        [],
        nutrition([{ from: "2026-05-20", calories: 3000, deficitPerDay: 400, note: "Earlier note." }])
      );

      expect(entries.map((e) => e.label)).toEqual(["Block started"]);
      expect(entries.some((e) => e.note)).toBe(false);
    });
  });
});
