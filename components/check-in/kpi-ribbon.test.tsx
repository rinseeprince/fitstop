import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The real units context pulls in the Supabase browser client, which throws on
// import without env vars. The ribbon only reads the preference.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric" }),
}));

import { KPIRibbon } from "./kpi-ribbon";
import type { CheckIn } from "@/types/check-in";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";

const checkIn = { id: "ci-1", weight: 80, workoutsCompleted: 3 } as unknown as CheckIn;
const adherence = { completed: 3, planned: 4, full: 3, partial: 0, missed: 1, pct: 75 } as never;

// A ribbon over an arbitrary training summary, for the training-cell cases.
function renderTraining(summary: Record<string, number | null>) {
  return render(
    <KPIRibbon
      checkIn={checkIn}
      comparisonData={null}
      adherence={summary as never}
      nutrition={nutrition()}
    />,
  );
}

/** The kernel's figures; only the ones the cell reads vary per case. */
function nutrition(
  overrides: Partial<CheckInPeriodAdherence["nutrition"]> = {},
): CheckInPeriodAdherence["nutrition"] {
  return {
    rail: [],
    periodDays: 7,
    loggedDays: 3,
    targetedDays: 7,
    judgedDays: 3,
    loggedNoTargetDays: 0,
    onTarget: 3,
    over: 0,
    under: 0,
    daysOnTargetPct: 43,
    targetTotals: { calories: 14000, proteinG: 1050, carbsG: 1400, fatG: 420 },
    consumedOnTargetedDays: { calories: 6000, proteinG: 450, carbsG: 600, fatG: 180 },
    calorieAdherencePct: 42.9,
    periodVerdict: "missed",
    perJudgedDay: {
      consumed: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
      target: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
    },
    intakePerLoggedDay: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
    netCaloriesOnJudgedDays: 0,
    ...overrides,
  };
}

function renderRibbon(nutritionValue: CheckInPeriodAdherence["nutrition"] | null) {
  return render(
    <KPIRibbon
      checkIn={checkIn}
      comparisonData={null}
      adherence={adherence}
      nutrition={nutritionValue}
    />,
  );
}

afterEach(cleanup);

describe("the nutrition cell", () => {
  it("counts days ON TARGET over the days a target was prescribed — a skipped targeted day is a miss", () => {
    // Three logged days all on target out of seven prescribed: 3/7, never
    // 3/3 and never "HIT" against a daily average.
    renderRibbon(nutrition());

    expect(screen.getByText("Nutrition")).toBeInTheDocument();
    expect(screen.getByText("3/7")).toBeInTheDocument();
    expect(screen.getByText("43%")).toBeInTheDocument();
    expect(screen.getByText("days on target")).toBeInTheDocument();
  });

  it("leaves a logged day with no target out of the ratio", () => {
    // The smoke week (owner, 2026-09-11): six of six prescribed days on
    // target, and today logged with nothing to hit. 6/6, never 6/7.
    renderRibbon(nutrition({ loggedDays: 7, targetedDays: 6, judgedDays: 6, loggedNoTargetDays: 1, onTarget: 6, daysOnTargetPct: 100 }));

    expect(screen.getByText("6/6")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByText("6/7")).not.toBeInTheDocument();
  });

  it("says No targets set, never 0/7 in red, when the coach prescribed nothing", () => {
    renderRibbon(nutrition({ loggedDays: 1, targetedDays: 0, judgedDays: 0, loggedNoTargetDays: 1, onTarget: 0, daysOnTargetPct: null }));

    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("No targets set")).toBeInTheDocument();
    expect(screen.queryByText("0/7")).not.toBeInTheDocument();
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
  });

  it("is no longer labelled Calories, and shows no daily average", () => {
    renderRibbon(nutrition());

    expect(screen.queryByText("Calories")).not.toBeInTheDocument();
    expect(screen.queryByText(/avg\/day/)).not.toBeInTheDocument();
    for (const verdict of ["HIT", "PARTIAL", "MISSED"]) {
      expect(screen.queryByText(verdict)).not.toBeInTheDocument();
    }
  });

  it("uses the period's OWN length on a short first week", () => {
    // D5.1: three of three, never three of seven.
    renderRibbon(nutrition({ periodDays: 3, targetedDays: 3, onTarget: 3, daysOnTargetPct: 100 }));

    expect(screen.getByText("3/3")).toBeInTheDocument();
  });

  it("reads its empty state when the period cannot be resolved", () => {
    // A legacy row with no resolvable period renders nothing rather than
    // falling back to a second, client-side definition of the figure.
    renderRibbon(null);

    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("No nutrition logs")).toBeInTheDocument();
  });

  it("leaves the training cell's fraction alone", () => {
    // Training is deliberately NOT on the nutrition/habit wire: the page's
    // figure counts full AND partial completions, the kernel's full only.
    renderRibbon(nutrition());

    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();
  });
});

describe("the training cell", () => {
  // The percentage the fraction already implies was displaced by the breakdown,
  // which says something the fraction cannot: that one of the three "completed"
  // sessions was only partly done.
  it("names the partial and missed counts instead of the percentage", () => {
    renderTraining({ completed: 3, planned: 5, full: 2, partial: 1, missed: 2, pct: 60 });

    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(screen.getByText("1 partial · 2 missed")).toBeInTheDocument();
    expect(screen.queryByText("60%")).not.toBeInTheDocument();
    expect(screen.queryByText("adherence")).not.toBeInTheDocument();
  });

  it("still goes amber at 60% — the percentage drives the accent, it is just not printed", () => {
    const { container } = renderTraining({
      completed: 3, planned: 5, full: 2, partial: 1, missed: 2, pct: 60,
    });

    // The dot is the accent. Amber (#d97706) is "attention"; teal is good.
    const cells = container.querySelectorAll(".flex.flex-col");
    const training = cells[cells.length - 1];
    expect(training.querySelector(".bg-\\[\\#d97706\\]")).not.toBeNull();
  });

  it("says 'All complete' only when nothing was partial OR missed", () => {
    renderTraining({ completed: 5, planned: 5, full: 5, partial: 0, missed: 0, pct: 100 });

    expect(screen.getByText("5/5")).toBeInTheDocument();
    expect(screen.getByText("All complete")).toBeInTheDocument();
  });

  it("never says 'All complete' over a skipped session", () => {
    renderTraining({ completed: 3, planned: 5, full: 3, partial: 0, missed: 2, pct: 60 });

    expect(screen.getByText("2 missed")).toBeInTheDocument();
    expect(screen.queryByText("All complete")).not.toBeInTheDocument();
  });

  it("never falls back to the stored workouts_completed column", () => {
    // That column counts full completions only. With nothing prescribed there is
    // no fraction to show, and a bare count computed a different way is not the
    // same statistic — the check-in fixture carries workoutsCompleted: 3.
    renderTraining({ completed: 0, planned: 0, full: 0, partial: 0, missed: 0, pct: null });

    expect(screen.getByText("No sessions prescribed")).toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });
});
