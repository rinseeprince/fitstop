import { describe, it, expect } from "vitest";
import { draftFromVersion, readScheduleDraft, type ScheduleDraft } from "./habit-schedule-draft";

const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  mode: "every",
  weekdays: [...EVERY_DAY],
  timesPerWeek: 3,
  target: "",
  ...over,
});

describe("draftFromVersion — a form seeded from a version's days and target", () => {
  it("reads all seven weekdays as every day, fewer as chosen days, a weekly version as times a week", () => {
    expect(draftFromVersion({ target: 3, timesPerWeek: null, weekdays: [...EVERY_DAY] })).toMatchObject({ mode: "every", target: "3" });
    expect(draftFromVersion({ target: null, timesPerWeek: null, weekdays: ["monday", "wednesday", "friday"] })).toMatchObject({
      mode: "set",
      weekdays: ["monday", "wednesday", "friday"],
      target: "",
    });
    expect(draftFromVersion({ target: 8000, timesPerWeek: 4, weekdays: [] })).toMatchObject({ mode: "weekly", timesPerWeek: 4, target: "8000" });
  });

  it("with no version, starts every day with an empty Target box", () => {
    expect(draftFromVersion(null)).toEqual({ mode: "every", weekdays: [...EVERY_DAY], timesPerWeek: 3, target: "" });
  });
});

describe("readScheduleDraft — what a form asks for", () => {
  it("asks every day as all seven weekdays, chosen days Monday first, and times a week as a number", () => {
    expect(readScheduleDraft("tick", draft())).toEqual({ schedule: { weekdays: [...EVERY_DAY] }, target: null });
    expect(readScheduleDraft("tick", draft({ mode: "set", weekdays: ["friday", "monday"] }))).toEqual({
      schedule: { weekdays: ["monday", "friday"] },
      target: null,
    });
    expect(readScheduleDraft("tick", draft({ mode: "weekly", timesPerWeek: 2 }))).toEqual({ schedule: { timesPerWeek: 2 }, target: null });
  });

  it("refuses chosen days with none chosen", () => {
    expect(readScheduleDraft("tick", draft({ mode: "set", weekdays: [] }))).toEqual({ error: "Pick at least one day" });
  });

  // Chosen days kept aside while another mode is picked are not asked for.
  it("asks no chosen days of every day or times a week, whatever the row last held", () => {
    expect(readScheduleDraft("tick", draft({ mode: "every", weekdays: [] }))).toEqual({ schedule: { weekdays: [...EVERY_DAY] }, target: null });
    expect(readScheduleDraft("tick", draft({ mode: "weekly", weekdays: [] }))).toEqual({ schedule: { timesPerWeek: 3 }, target: null });
  });

  it("reads a number habit's target as typed, and a tick habit's as none whatever the box holds", () => {
    expect(readScheduleDraft("number", draft({ target: " 2.5 " }))).toMatchObject({ target: 2.5 });
    expect(readScheduleDraft("tick", draft({ target: "4" }))).toMatchObject({ target: null });
  });

  it("refuses a number habit with no target, or one that is not a number", () => {
    expect(readScheduleDraft("number", draft({ target: "  " }))).toEqual({ error: "Enter a target" });
    expect(readScheduleDraft("number", draft({ target: "three" }))).toEqual({ error: "Enter a number, to two decimals at most" });
  });
});
