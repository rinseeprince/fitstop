import { describe, expect, it } from "vitest";
import { deriveTimelineEntries } from "./block-timeline";
import type { BlockNutritionFact } from "@/types/client-blocks";

const nutrition = (
  eras: BlockNutritionFact["eras"]
): BlockNutritionFact => ({
  calories: 2200,
  deficitPerDay: 400,
  changeCount: 0,
  lastChangedOn: null,
  eras,
});

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
      null
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
    const entries = deriveTimelineEntries({ ...BLOCK, state: "past" }, [], null);
    expect(entries.map((e) => e.label)).toEqual(["Block started", "Block ended"]);
  });

  it("future block with nothing placed: empty — the renderer says \"Nothing yet.\"", () => {
    expect(deriveTimelineEntries({ ...BLOCK, state: "future" }, [], null)).toEqual([]);
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

    it("no nutrition fact: the timeline is unchanged", () => {
      const entries = deriveTimelineEntries({ ...BLOCK, state: "current" }, [], null);
      expect(entries.map((e) => e.label)).toEqual(["Block started"]);
    });

    // Same reason its "Block started" entry is skipped: nothing has happened.
    it("future block: no nutrition entry even with a queued era", () => {
      const entries = deriveTimelineEntries(
        { ...BLOCK, state: "future" },
        [],
        nutrition([{ from: "2026-06-01", calories: 3471, deficitPerDay: 629 }])
      );
      expect(entries).toEqual([]);
    });
  });

  it("future block with a queued placement: the placement is the only entry", () => {
    const entries = deriveTimelineEntries(
      { ...BLOCK, state: "future" },
      [plan("p1", "Base", "2026-06-03")],
      null
    );
    expect(entries.map((e) => e.label)).toEqual(["Base started"]);
  });
});
