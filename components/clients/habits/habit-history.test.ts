import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { habitHistoryLines } from "./habit-history";
import type { HabitVersion } from "@/types/habits";

const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const steps = { measure: "number" as const, unit: "steps", direction: "at_least" as const };
const walk = { measure: "tick" as const, unit: null, direction: null };

const version = (startsOn: string, endsOn: string | null, over: Partial<HabitVersion> = {}): HabitVersion => ({
  id: `v-${startsOn}`,
  startsOn,
  endsOn,
  target: null,
  timesPerWeek: null,
  weekdays: [...EVERY_DAY],
  ...over,
});

// The year is the device's, for the short date's "with its year when that isn't this year".
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T09:00:00"));
});
afterAll(() => vi.useRealTimers());

describe("habitHistoryLines — a habit's versions in words, oldest first", () => {
  it("writes each run of days with its days then its target, an open run from its first day", () => {
    const lines = habitHistoryLines(
      {
        ...steps,
        versions: [
          version("2026-10-05", "2026-10-18", { target: 6000 }),
          version("2026-10-19", null, { target: 8000, timesPerWeek: 5, weekdays: [] }),
        ],
      },
      "2026-09-30"
    );
    expect(lines).toEqual(["5 Oct – 18 Oct · Every day · at least 6,000 steps", "From 19 Oct · 5 times a week · at least 8,000 steps"]);
  });

  it("says the day a habit stops when nothing runs straight after: stopped by today, stops ahead of it", () => {
    expect(habitHistoryLines({ ...walk, versions: [version("2026-09-01", "2026-09-11")] }, "2026-09-30")).toEqual([
      "1 Sept – 11 Sept · Every day",
      "Stopped 12 Sept",
    ]);
    expect(habitHistoryLines({ ...walk, versions: [version("2026-09-01", "2026-11-01")] }, "2026-09-30")).toEqual([
      "1 Sept – 1 Nov · Every day",
      "Stops 2 Nov",
    ]);
    // Stopped from today: it does not run today.
    expect(habitHistoryLines({ ...walk, versions: [version("2026-09-01", "2026-09-29")] }, "2026-09-30")[1]).toBe("Stopped 30 Sept");
  });

  it("marks a gap between two runs with the day it stopped, then the run that starts it again", () => {
    const lines = habitHistoryLines(
      {
        ...walk,
        versions: [
          version("2026-09-01", "2026-09-11", { weekdays: ["monday", "wednesday", "friday"] }),
          version("2026-09-21", null, { weekdays: ["monday", "wednesday", "friday"] }),
        ],
      },
      "2026-09-30"
    );
    expect(lines).toEqual(["1 Sept – 11 Sept · Mon, Wed, Fri", "Stopped 12 Sept", "From 21 Sept · Mon, Wed, Fri"]);
  });

  it("gives a date outside this year its year", () => {
    expect(habitHistoryLines({ ...walk, versions: [version("2025-12-29", null)] }, "2026-09-30")).toEqual(["From 29 Dec 2025 · Every day"]);
  });

  it("says a habit stopped before its first day never ran", () => {
    expect(habitHistoryLines({ ...walk, versions: [] }, "2026-09-30")).toEqual(["Never ran"]);
  });
});
