import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WeekGrid } from "./week-grid";
import { macroMark, MACRO_MARK } from "./week-grid-words";
import { summarizeNutritionPeriod } from "@/utils/nutrition-period-summary";
import { summariseTraining } from "@/lib/training-adherence";
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

const workout = (eventId: string, date: string, sessionName: string, done: boolean): CheckInTrainingEventDetail => ({
  eventId,
  date,
  sessionName,
  status: done ? "completed" : "scheduled",
  logStatus: done ? "logged" : "not_logged",
  completionQuality: done ? "full" : null,
  trainingSessionId: `ts-${eventId}`,
  sessionLogId: done ? `sl-${eventId}` : null,
});

const WORKOUTS = [workout("e-1", "2026-09-22", "Upper A", false), workout("e-2", "2026-09-25", "Lower A", false)];

function renderGrid(overrides: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  const workouts = overrides.workouts ?? WORKOUTS;
  return render(
    <WeekGrid
      dates={DATES}
      workouts={workouts}
      training={summariseTraining(workouts)}
      highlights={[]}
      nutrition={nutritionOf(WEEK)}
      {...overrides}
    />
  );
}

const cell = (container: HTMLElement, row: string, date: string) =>
  container.querySelector<HTMLElement>(`[data-row="${row}"] [data-day="${date}"]`)!;
const average = (container: HTMLElement, row: string) =>
  container.querySelector<HTMLElement>(`[data-row="${row}"] [data-average]`)!;

afterEach(cleanup);

describe("one grid for the week — training, calories and macros under the same days", () => {
  it("sets the days out once, oldest first, every row on the same columns", () => {
    const { container } = renderGrid();
    const header = [...container.querySelectorAll<HTMLElement>('[data-row="days"] [data-day]')];

    expect(header.map((day) => day.dataset.day)).toEqual(DATES);
    expect(header.map((day) => day.textContent)).toEqual(["Sun20", "Mon21", "Tue22", "Wed23", "Thu24", "Fri25", "Sat26"]);
    for (const row of ["training", "calories", "protein", "carbs", "fats"]) {
      expect([...container.querySelectorAll(`[data-row="${row}"] [data-day]`)].map((day) => (day as HTMLElement).dataset.day)).toEqual(DATES);
    }
  });

  it("puts each workout under its own day with its word, and gives training no average", () => {
    const both = [...WORKOUTS, workout("e-3", "2026-09-25", "Mobility", true)];
    const { container } = renderGrid({ workouts: both });

    expect(cell(container, "training", "2026-09-22").textContent).toContain("Upper A");
    expect(within(cell(container, "training", "2026-09-22")).getByText("Missed")).toBeInTheDocument();
    // A day shows every workout on it.
    expect(cell(container, "training", "2026-09-25").textContent).toContain("Lower A");
    expect(within(cell(container, "training", "2026-09-25")).getByText("Full")).toBeInTheDocument();
    expect(cell(container, "training", "2026-09-20").textContent).toBe("—");
    expect(screen.getByText("3 sessions planned")).toBeInTheDocument();
    // The average column belongs to the nutrition rows: bare beside Training
    // and the day header, and headed where it starts.
    expect(average(container, "training").textContent).toBe("");
    expect(average(container, "training").className).not.toContain("bg-");
    expect(average(container, "days").textContent).toBe("");
    expect(average(container, "calories").textContent).toMatch(/^Avg/);
  });

  it("puts each day's target over what was eaten, the bar under them and the word the check-in froze under that", () => {
    const { container } = renderGrid();

    expect(cell(container, "calories", "2026-09-21").textContent).toBe("2,3002,260On target");
    expect(cell(container, "calories", "2026-09-22").textContent).toBe("2,3002,140Partial");
    expect(cell(container, "calories", "2026-09-23").textContent).toBe("2,3001,690Missed");
    expect(cell(container, "calories", "2026-09-24").textContent).toBe("2,300—No food logged");
    // No target covered the day: a blank line where the target would be.
    expect(cell(container, "calories", "2026-09-20").textContent).toBe(" 1,870No target");
    // Per judged day on both sides: 10,890 eaten over five days, against 2,300 a day.
    expect(average(container, "calories").textContent).toBe("Avg2,3002,178kcal / day");
  });

  it("shows each day under its OWN target, so a training day's surplus reads on the day it lands", () => {
    const training: Figures = [2576, 172, 271, 90];
    const surplus = WEEK.map((day) =>
      day.date === "2026-09-22" ? food("2026-09-22", "hit", [2601, 175, 280, 88], training) : day
    );
    const { container } = renderGrid({ nutrition: nutritionOf(surplus) });

    expect(cell(container, "calories", "2026-09-22").textContent).toBe("2,5762,601On target");
    expect(cell(container, "calories", "2026-09-21").textContent).toBe("2,3002,260On target");
    expect(cell(container, "carbs", "2026-09-22").textContent).toBe("271g280");
    // 280 against its own 271 is on target; against the rest day's 202 it would be tinted.
    expect(within(cell(container, "carbs", "2026-09-22")).getByText("280").className).not.toMatch(/bg-/);
  });

  it("carries the week's total against its target and its bar beside the Calories row, and nothing on the rail", () => {
    const { container } = renderGrid();
    const label = container.querySelector<HTMLElement>('[data-row="calories"] > div')!;

    expect(label.textContent).toBe("Calories10,890of 13,800 kcal");
    expect(screen.queryByText(/2\/6 on target/)).not.toBeInTheDocument();
    expect(screen.queryByText(/MISSED/)).not.toBeInTheDocument();
  });

  it("words the day from the standing the check-in froze, never from its numbers", () => {
    // Frozen as on target with figures today's thresholds would call missed:
    // a sent week never rewords itself.
    const frozen = [food("2026-09-20", "hit", [1500, 110, 140, 50], TARGET)];
    const { container } = renderGrid({ dates: ["2026-09-20"], nutrition: nutritionOf(frozen) });

    expect(cell(container, "calories", "2026-09-20").textContent).toBe("2,3001,500On target");
  });

  it("tints a macro 10% or more off that day's target — under in blue, over in amber — and never a day with no target", () => {
    const { container } = renderGrid();
    const figure = (row: string, date: string, value: string) => within(cell(container, row, date)).getByText(value);

    // A tinted figure carries its words for a screen reader.
    expect(cell(container, "protein", "2026-09-23").textContent).toBe("172g133, 10% or more under target");
    expect(figure("protein", "2026-09-23", "133").className).toContain(MACRO_MARK.under.tint);
    expect(figure("carbs", "2026-09-21", "236").className).toContain(MACRO_MARK.over.tint);
    expect(figure("protein", "2026-09-21", "169").className).not.toMatch(/bg-/);
    expect(cell(container, "protein", "2026-09-20").textContent).toBe(" 148");
    expect(figure("protein", "2026-09-20", "148").className).not.toMatch(/bg-/);
    expect(cell(container, "fats", "2026-09-24").textContent).toBe("90g—");
    // The averages, per judged day, against the judged days' target.
    expect(average(container, "protein").textContent).toBe("172g164");
    expect(within(average(container, "protein")).getByText("164").className).not.toMatch(/bg-/);
    expect(within(average(container, "carbs")).getByText("225").className).toContain(MACRO_MARK.over.tint);
    expect(within(average(container, "fats")).getByText("69").className).toContain(MACRO_MARK.under.tint);
  });

  it("marks exactly 10% off, either side, and nothing inside it", () => {
    expect(macroMark(180, 200)).toBe("under");
    expect(macroMark(181, 200)).toBeNull();
    expect(macroMark(220, 200)).toBe("over");
    expect(macroMark(219, 200)).toBeNull();
    expect(macroMark(150, null)).toBeNull();
    expect(macroMark(null, 200)).toBeNull();
  });

  it("says no target was set, with no total and no bar, when the coach prescribed nothing all week", () => {
    const untargeted = [food("2026-09-20", "no_target", [1870, 148, 190, 62], null), food("2026-09-21", "no_target", [2105, 176, 198, 61], null)];
    const { container } = renderGrid({ dates: ["2026-09-20", "2026-09-21"], nutrition: nutritionOf(untargeted) });

    expect(container.querySelector<HTMLElement>('[data-row="calories"] > div')!.textContent).toBe("CaloriesNo target set");
    expect(screen.queryByText(/kcal target|of .* kcal/)).not.toBeInTheDocument();
    // What they ate per logged day, named so, under a blank target line.
    expect(average(container, "calories").textContent).toBe("Avg 1,988kcal / logged day");
  });

  it("keeps only the legend a glance can't read off the grid, and no footer note", () => {
    const { container } = renderGrid();

    expect(container.querySelector("[data-legend]")!.textContent).toBe("No food loggedTarget10%+ under10%+ over");
    expect(screen.queryByText(/isn't counted/)).not.toBeInTheDocument();
  });

  it("shows the week's training alone on a legacy row whose copy saved no week", () => {
    const { container } = renderGrid({ nutrition: null });

    expect(container.querySelector('[data-row="training"]')).not.toBeNull();
    expect(container.querySelector('[data-row="calories"]')).toBeNull();
    expect(container.querySelector("[data-legend]")).toBeNull();
    expect(screen.queryByText("Avg")).not.toBeInTheDocument();
  });
});

describe("the grid computes nothing", () => {
  // The defect this guards: a review card once summed calories over the days
  // with a target and macros over the days a macro was logged, and read 173 g
  // against 146 g for a client on 170 g every day. The grid takes no log rows,
  // folds no figure and judges no day: a day's word is the standing the
  // check-in froze, and the training count is the page's.
  it("takes no log rows, folds no figure and judges no day", () => {
    for (const file of ["week-grid.tsx", "week-grid-rows.tsx", "week-grid-words.ts"]) {
      const source = readFileSync(join(process.cwd(), "components/check-in", file), "utf8");
      expect(source).not.toMatch(/dailyLogs|DailyLog|\.reduce\(|fullWeekTarget|periodDays|nutrition-verdict|classifyDay|summariseTraining\(|workouts_?[cC]ompleted/);
    }
  });
});
