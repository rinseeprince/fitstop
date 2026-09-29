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
  it("sets the days out once, oldest first, with an average column on the right", () => {
    const { container } = renderGrid();
    const header = [...container.querySelectorAll<HTMLElement>('[data-row="days"] [data-day]')];

    expect(header.map((day) => day.dataset.day)).toEqual(DATES);
    expect(header.map((day) => day.textContent)).toEqual(["Sun20", "Mon21", "Tue22", "Wed23", "Thu24", "Fri25", "Sat26"]);
    expect(average(container, "days").textContent).toBe("Avg");
    for (const row of ["training", "calories", "protein", "carbs", "fats"]) {
      expect([...container.querySelectorAll(`[data-row="${row}"] [data-day]`)].map((day) => (day as HTMLElement).dataset.day)).toEqual(DATES);
    }
  });

  it("puts each workout under its own day with its word, and the page's count in the average", () => {
    const both = [...WORKOUTS, workout("e-3", "2026-09-25", "Mobility", true)];
    const { container } = renderGrid({ workouts: both });

    expect(cell(container, "training", "2026-09-22").textContent).toContain("Upper A");
    expect(within(cell(container, "training", "2026-09-22")).getByText("Missed")).toBeInTheDocument();
    // A day shows every workout on it.
    expect(cell(container, "training", "2026-09-25").textContent).toContain("Lower A");
    expect(within(cell(container, "training", "2026-09-25")).getByText("Full")).toBeInTheDocument();
    expect(cell(container, "training", "2026-09-20").textContent).toBe("—");
    expect(average(container, "training").textContent).toBe("1/3");
    expect(screen.getByText("3 sessions planned")).toBeInTheDocument();
  });

  it("puts each day's eaten calories over its bar, with the word the check-in froze under it", () => {
    const { container } = renderGrid();

    expect(cell(container, "calories", "2026-09-21").textContent).toBe("2,260On target");
    expect(cell(container, "calories", "2026-09-22").textContent).toBe("2,140Partial");
    expect(cell(container, "calories", "2026-09-23").textContent).toBe("1,690Missed");
    expect(cell(container, "calories", "2026-09-24").textContent).toBe("—No food logged");
    expect(cell(container, "calories", "2026-09-20").textContent).toBe("1,870No target");
    expect(screen.getByText("Target 2,300")).toBeInTheDocument();
    // Per judged day: 10,890 over five days.
    expect(average(container, "calories").textContent).toBe("2,178kcal / day");
  });

  it("words the day from the standing the check-in froze, never from its numbers", () => {
    // Frozen as on target with figures today's thresholds would call missed:
    // a sent week never rewords itself.
    const frozen = [food("2026-09-20", "hit", [1500, 110, 140, 50], TARGET)];
    const { container } = renderGrid({ dates: ["2026-09-20"], nutrition: nutritionOf(frozen) });

    expect(cell(container, "calories", "2026-09-20").textContent).toBe("1,500On target");
  });

  it("tints a macro 10% or more off that day's target — under in blue, over in amber — and never a day with no target", () => {
    const { container } = renderGrid();
    const figure = (row: string, date: string, value: string) => within(cell(container, row, date)).getByText(value);

    expect(figure("protein", "2026-09-23", "133").className).toContain(MACRO_MARK.under.tint);
    expect(figure("carbs", "2026-09-21", "236").className).toContain(MACRO_MARK.over.tint);
    expect(figure("protein", "2026-09-21", "169").className).not.toMatch(/bg-/);
    expect(figure("protein", "2026-09-20", "148").className).not.toMatch(/bg-/);
    expect(cell(container, "fats", "2026-09-24").textContent).toBe("—");
    // The averages, per judged day, against the judged days' target.
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

  it("carries the week's total against its target, the bar and the pill on its rail", () => {
    renderGrid();

    expect(screen.getByText("10,890")).toBeInTheDocument();
    expect(screen.getByText(/of 13,800 kcal/)).toBeInTheDocument();
    expect(screen.getByText("MISSED · 2/6 on target")).toBeInTheDocument();
  });

  it("says no target was set, with no total, no bar and no pill, when the coach prescribed nothing all week", () => {
    const untargeted = [food("2026-09-20", "no_target", [1870, 148, 190, 62], null), food("2026-09-21", "no_target", [2105, 176, 198, 61], null)];
    const { container } = renderGrid({ dates: ["2026-09-20", "2026-09-21"], nutrition: nutritionOf(untargeted) });

    expect(screen.getByText("No target set this week")).toBeInTheDocument();
    expect(screen.queryByText(/on target/)).not.toBeInTheDocument();
    expect(screen.getByText("No target set")).toBeInTheDocument();
    // What they ate per logged day, named so.
    expect(average(container, "calories").textContent).toBe("1,988kcal / logged day");
  });

  it("names the logged days no target covered, one or several", () => {
    renderGrid();
    expect(screen.getByText("Sun has no target and isn't counted")).toBeInTheDocument();
    cleanup();

    const two = [food("2026-09-20", "no_target", [1870, 148, 190, 62], null), food("2026-09-21", "no_target", [2105, 176, 198, 61], null)];
    renderGrid({ dates: ["2026-09-20", "2026-09-21"], nutrition: nutritionOf(two) });
    expect(screen.getByText("Sun and Mon have no target and aren't counted")).toBeInTheDocument();
  });

  it("shows the week's training alone on a legacy row whose copy saved no week", () => {
    const { container } = renderGrid({ nutrition: null });

    expect(container.querySelector('[data-row="training"]')).not.toBeNull();
    expect(container.querySelector('[data-row="calories"]')).toBeNull();
    expect(screen.queryByText(/on target/i)).not.toBeInTheDocument();
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
