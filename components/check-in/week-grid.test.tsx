import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WeekGrid } from "./week-grid";
import { macroMark, MACRO_MARK } from "./week-grid-words";
import { summarizeNutritionPeriod } from "@/utils/nutrition-period-summary";
import type { CheckInTrainingEventDetail } from "@/types/check-in";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";
import type { NutritionDay } from "@/types/schedule";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

type Figures = [number, number, number, number];
const TARGET: Figures = [2300, 172, 202, 90];

const food = (date: string, status: NutritionDay["status"], eaten: Figures | null, target: Figures | null): NutritionDay => ({
  date,
  dayOfWeek: "monday",
  status,
  targetCalories: target?.[0] ?? null,
  targetProteinG: target?.[1] ?? null,
  targetCarbsG: target?.[2] ?? null,
  targetFatG: target?.[3] ?? null,
  actualCalories: eaten?.[0] ?? null,
  actualProteinG: eaten?.[1] ?? null,
  actualCarbsG: eaten?.[2] ?? null,
  actualFatG: eaten?.[3] ?? null,
});

const DATES = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"];

/** The smoke week as the check-in froze it: every one of the five words. */
const WEEK: NutritionDay[] = [
  food("2026-09-20", "no_target", [1870, 148, 190, 62], null),
  food("2026-09-21", "hit", [2260, 169, 236, 70], TARGET),
  food("2026-09-22", "partial", [2140, 161, 219, 66], TARGET),
  food("2026-09-23", "missed", [1690, 133, 168, 58], TARGET),
  food("2026-09-24", "not_logged", null, TARGET),
  food("2026-09-25", "hit", [2330, 175, 244, 72], TARGET),
  food("2026-09-26", "partial", [2470, 183, 258, 77], TARGET),
];

/** The kernel over the frozen rows — the grid renders its figures and counts nothing. */
const nutritionOf = (days: NutritionDay[]): CheckInPeriodAdherence["nutrition"] => ({
  rail: [],
  days,
  ...summarizeNutritionPeriod(days),
});

const workout = (
  eventId: string,
  date: string,
  sessionName: string,
  quality: "full" | "partial" | null
): CheckInTrainingEventDetail => ({
  eventId,
  date,
  sessionName,
  status: quality ? "completed" : "scheduled",
  logStatus: quality ? "logged" : "not_logged",
  completionQuality: quality,
  trainingSessionId: `ts-${eventId}`,
  sessionLogId: quality ? `sl-${eventId}` : null,
});

const WORKOUTS = [workout("e-1", "2026-09-22", "Upper A", null), workout("e-2", "2026-09-25", "Lower A", "full")];

function renderGrid(overrides: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  return render(<WeekGrid dates={DATES} workouts={WORKOUTS} highlights={[]} nutrition={nutritionOf(WEEK)} {...overrides} />);
}

const cell = (container: HTMLElement, date: string, col: string) =>
  container.querySelector<HTMLElement>(`[data-day="${date}"] [data-col="${col}"]`)!;
const week = (container: HTMLElement, col: string) => container.querySelector<HTMLElement>(`[data-week] [data-col="${col}"]`)!;

afterEach(cleanup);

describe("the week, one line per day — its workouts, its calories and macros over its own target, and its word", () => {
  it("lists one line per day, oldest first, under the columns' headings", () => {
    const { container } = renderGrid();

    expect([...container.querySelectorAll<HTMLElement>("[data-day]")].map((row) => row.dataset.day)).toEqual(DATES);
    expect(cell(container, "2026-09-20", "day").textContent).toBe("Sun20");
    expect(cell(container, "2026-09-26", "day").textContent).toBe("Sat26");
    for (const heading of ["Day", "Training", "Calories (kcal)", "Protein (g)", "Carbs (g)", "Fats (g)", "Nutrition"]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
  });

  it("puts each workout on its own day — a word where it went short, the tick alone when done in full", () => {
    const { container } = renderGrid();

    expect(cell(container, "2026-09-22", "training").textContent).toBe("Upper AMissed");
    expect(within(cell(container, "2026-09-22", "training")).getByText("Missed").className).toContain("text-[#c06060]");
    // Full: the tick, and the word for a screen reader only.
    expect(within(cell(container, "2026-09-25", "training")).getByText("Full").className).toContain("sr-only");
    expect(cell(container, "2026-09-20", "training").textContent).toBe("—");
  });

  it("holds two workouts on a day's line, and opens the rest from +N more", () => {
    const day = "2026-09-24";
    const three = [
      workout("e-3", day, "Lower A", "full"),
      workout("e-4", day, "Mobility", "partial"),
      workout("e-5", day, "Core finisher", null),
    ];
    const { container } = renderGrid({ workouts: three });
    const training = cell(container, day, "training");

    expect(within(training).getByText("Lower A")).toBeInTheDocument();
    expect(within(training).getByText("Mobility")).toBeInTheDocument();
    expect(within(training).queryByText("Core finisher")).not.toBeInTheDocument();

    fireEvent.click(within(training).getByRole("button", { name: "+1 more" }));
    const list = screen.getByRole("dialog");
    expect(within(list).getByText("Thursday, Sep 24")).toBeInTheDocument();
    expect(within(list).getByText("3 sessions")).toBeInTheDocument();
    for (const name of ["Lower A", "Mobility", "Core finisher"]) expect(within(list).getByText(name)).toBeInTheDocument();
  });

  it("puts each day's calories eaten over its own target, and the day's frozen word in the Nutrition column", () => {
    const { container } = renderGrid();

    expect(cell(container, "2026-09-21", "calories").textContent).toBe("2,260 / 2,300");
    expect(cell(container, "2026-09-21", "nutrition").textContent).toBe("On target");
    expect(cell(container, "2026-09-23", "nutrition").textContent).toBe("Missed");
    expect(cell(container, "2026-09-24", "calories").textContent).toBe("— / 2,300");
    expect(cell(container, "2026-09-24", "nutrition").textContent).toBe("No food logged");
    expect(cell(container, "2026-09-20", "calories").textContent).toBe("1,870");
    expect(cell(container, "2026-09-20", "nutrition").textContent).toBe("No target");
  });

  it("shows each day under its OWN target, so a training day's surplus reads on the day it lands", () => {
    const training: Figures = [2576, 172, 271, 90];
    const surplus = WEEK.map((day) =>
      day.date === "2026-09-22" ? food("2026-09-22", "hit", [2601, 175, 280, 88], training) : day
    );
    const { container } = renderGrid({ nutrition: nutritionOf(surplus) });

    expect(cell(container, "2026-09-22", "calories").textContent).toBe("2,601 / 2,576");
    expect(cell(container, "2026-09-21", "calories").textContent).toBe("2,260 / 2,300");
    expect(cell(container, "2026-09-22", "carbs").textContent).toBe("280 / 271");
    // 280 against its own 271 is on target; against the rest day's 202 it would be tinted.
    expect(within(cell(container, "2026-09-22", "carbs")).getByText("280").className).not.toMatch(/bg-/);
  });

  it("words the day from the standing the check-in froze, never from its numbers", () => {
    // Frozen as on target with figures today's thresholds would call missed:
    // a sent week never rewords itself.
    const frozen = [food("2026-09-20", "hit", [1500, 110, 140, 50], TARGET)];
    const { container } = renderGrid({ dates: ["2026-09-20"], nutrition: nutritionOf(frozen) });

    expect(cell(container, "2026-09-20", "nutrition").textContent).toBe("On target");
  });

  it("tints a macro 10% or more off that day's target — under in blue, over in amber — and never a day with no target", () => {
    const { container } = renderGrid();
    const figure = (date: string, col: string, value: string) => within(cell(container, date, col)).getByText(value);

    expect(figure("2026-09-23", "protein", "133").className).toContain(MACRO_MARK.under.tint);
    expect(figure("2026-09-21", "carbs", "236").className).toContain(MACRO_MARK.over.tint);
    expect(figure("2026-09-21", "protein", "169").className).not.toMatch(/bg-/);
    expect(cell(container, "2026-09-20", "protein").textContent).toBe("148");
    expect(figure("2026-09-20", "protein", "148").className).not.toMatch(/bg-/);
    expect(cell(container, "2026-09-24", "fats").textContent).toBe("— / 90");
  });

  it("marks exactly 10% off, either side, and nothing inside it", () => {
    expect(macroMark(180, 200)).toBe("under");
    expect(macroMark(181, 200)).toBeNull();
    expect(macroMark(220, 200)).toBe("over");
    expect(macroMark(219, 200)).toBeNull();
    expect(macroMark(150, null)).toBeNull();
    expect(macroMark(null, 200)).toBeNull();
  });

  it("closes the week like a day: its total over its target with a bar, the averages, and the week's word", () => {
    const { container } = renderGrid();

    expect(week(container, "day").textContent).toBe("Week");
    // The calorie average per judged day, where Training sits.
    expect(week(container, "training").textContent).toBe("2,178 / 2,300 kcal avg / day");
    // The kernel's totals — 10,890 eaten on the targeted days against 13,800 —
    // the figures the week's word judges, so the bar agrees with it.
    expect(week(container, "calories").textContent).toBe("10,890 / 13,800");
    const fill = week(container, "calories").querySelector<HTMLElement>('[data-bar="fill"]')!;
    const tick = week(container, "calories").querySelector<HTMLElement>('[data-bar="tick"]')!;
    expect(fill.className).toContain("bg-[#c06060]");
    expect(parseFloat(fill.style.width)).toBeCloseTo((10890 / (13800 * 1.08)) * 100, 1);
    expect(parseFloat(tick.style.left)).toBeCloseTo((1 / 1.08) * 100, 1);
    expect(week(container, "nutrition").textContent).toBe("Missed");
    expect(week(container, "protein").textContent).toBe("164 / 172");
    expect(within(week(container, "protein")).getByText("164").className).not.toMatch(/bg-/);
    expect(within(week(container, "carbs")).getByText("225").className).toContain(MACRO_MARK.over.tint);
    expect(within(week(container, "fats")).getByText("69").className).toContain(MACRO_MARK.under.tint);
    expect(screen.queryByText(/\d of \d/)).not.toBeInTheDocument();
  });

  it("words the week from the kernel's verdict, the bar in the same colour", () => {
    // Every targeted day eaten close to its target: the week is on target.
    const close = [food("2026-09-21", "hit", [2280, 170, 200, 90], TARGET), food("2026-09-22", "hit", [2330, 173, 205, 91], TARGET)];
    const { container } = renderGrid({ dates: ["2026-09-21", "2026-09-22"], nutrition: nutritionOf(close) });

    expect(week(container, "nutrition").textContent).toBe("On target");
    expect(week(container, "calories").querySelector('[data-bar="fill"]')!.className).toContain("bg-[#0d9488]");
  });

  it("says no target was set, with no bar, and averages per logged day, when the coach prescribed nothing all week", () => {
    const untargeted = [food("2026-09-20", "no_target", [1870, 148, 190, 62], null), food("2026-09-21", "no_target", [2105, 176, 198, 61], null)];
    const { container } = renderGrid({ dates: ["2026-09-20", "2026-09-21"], nutrition: nutritionOf(untargeted) });

    expect(week(container, "training").textContent).toBe("1,988 kcal avg / logged day");
    expect(week(container, "calories").textContent).toBe("No target set");
    expect(week(container, "calories").querySelector("[data-bar]")).toBeNull();
    expect(week(container, "nutrition").textContent).toBe("No target");
  });

  it("keeps only the legend a glance can't read off the rows", () => {
    const { container } = renderGrid();

    expect(container.querySelector("[data-legend]")!.textContent).toBe("Day's target10%+ under10%+ over");
  });

  it("shows the week's training alone on a legacy row whose copy saved no week", () => {
    const { container } = renderGrid({ nutrition: null });

    expect(cell(container, "2026-09-22", "training").textContent).toBe("Upper AMissed");
    expect(container.querySelector('[data-col="calories"]')).toBeNull();
    expect(container.querySelector("[data-week]")).toBeNull();
    expect(container.querySelector("[data-legend]")).toBeNull();
  });
});

describe("the grid computes nothing", () => {
  // The defect this guards: a review card once summed calories over the days
  // with a target and macros over the days a macro was logged, and read 173 g
  // against 146 g for a client on 170 g every day. The grid takes no log rows,
  // folds no figure and judges no day: a day's word is the standing the
  // check-in froze, and the week's figures are the kernel's.
  it("takes no log rows, folds no figure and judges no day", () => {
    for (const file of ["week-grid.tsx", "week-grid-rows.tsx", "week-grid-words.ts"]) {
      const source = readFileSync(join(process.cwd(), "components/check-in", file), "utf8");
      expect(source).not.toMatch(/dailyLogs|DailyLog|\.reduce\(|fullWeekTarget|periodDays|nutrition-verdict|classifyDay|summariseTraining\(|workouts_?[cC]ompleted/);
    }
  });
});
