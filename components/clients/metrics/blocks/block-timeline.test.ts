import { describe, expect, it } from "vitest";
import { deriveTimelineEntries } from "./block-timeline";

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
      ]
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
    const entries = deriveTimelineEntries({ ...BLOCK, state: "past" }, []);
    expect(entries.map((e) => e.label)).toEqual(["Block started", "Block ended"]);
  });

  it("future block with nothing placed: empty — the renderer says \"Nothing yet.\"", () => {
    expect(deriveTimelineEntries({ ...BLOCK, state: "future" }, [])).toEqual([]);
  });

  it("future block with a queued placement: the placement is the only entry", () => {
    const entries = deriveTimelineEntries({ ...BLOCK, state: "future" }, [
      plan("p1", "Base", "2026-06-03"),
    ]);
    expect(entries.map((e) => e.label)).toEqual(["Base started"]);
  });
});
