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
const adherence = { completed: 3, prescribed: 4, full: 3, partial: 0, missed: 1, pct: 75 } as never;

// A ribbon over an arbitrary session summary, for the training-cell cases.
function renderTraining(summary: Record<string, number>) {
  return render(
    <KPIRibbon
      checkIn={checkIn}
      comparisonData={null}
      adherence={summary as never}
      nutrition={nutrition()}
      periodDays={7}
    />,
  );
}

function nutrition(
  overrides: Partial<CheckInPeriodAdherence["nutrition"]> = {},
): CheckInPeriodAdherence["nutrition"] {
  return { rail: [], onTarget: 3, loggedDays: 3, pct: 43, ...overrides };
}

function renderRibbon(
  nutritionValue: CheckInPeriodAdherence["nutrition"] | null,
  periodDays: number | null,
) {
  return render(
    <KPIRibbon
      checkIn={checkIn}
      comparisonData={null}
      adherence={adherence}
      nutrition={nutritionValue}
      periodDays={periodDays}
    />,
  );
}

afterEach(cleanup);

describe("the nutrition cell", () => {
  it("counts days ON TARGET over the whole period", () => {
    // Three logged days all on target used to read "HIT" against a daily
    // average — a statement about three days dressed as one about the week.
    renderRibbon(nutrition(), 7);

    expect(screen.getByText("Nutrition")).toBeInTheDocument();
    expect(screen.getByText("3/7")).toBeInTheDocument();
    expect(screen.getByText("43%")).toBeInTheDocument();
    expect(screen.getByText("days on target")).toBeInTheDocument();
  });

  it("is no longer labelled Calories, and shows no daily average", () => {
    renderRibbon(nutrition(), 7);

    expect(screen.queryByText("Calories")).not.toBeInTheDocument();
    expect(screen.queryByText(/avg\/day/)).not.toBeInTheDocument();
    for (const verdict of ["HIT", "PARTIAL", "MISSED"]) {
      expect(screen.queryByText(verdict)).not.toBeInTheDocument();
    }
  });

  it("uses the period's OWN length on a short first week", () => {
    // D5.1: three of three, never three of seven.
    renderRibbon(nutrition({ onTarget: 3, pct: 100 }), 3);

    expect(screen.getByText("3/3")).toBeInTheDocument();
  });

  it("reads its empty state when the period cannot be resolved", () => {
    // A legacy row with no resolvable period renders nothing rather than
    // falling back to a second, client-side definition of the figure.
    renderRibbon(null, null);

    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("No nutrition logs")).toBeInTheDocument();
  });

  it("leaves the training cell's fraction alone", () => {
    // Training is deliberately NOT on the new wire: the page's figure counts
    // full AND partial completions, the kernel's counts full only.
    renderRibbon(nutrition(), 7);

    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();
  });
});

describe("the training cell", () => {
  // The percentage the fraction already implies was displaced by the breakdown,
  // which says something the fraction cannot: that one of the three "completed"
  // sessions was only partly done.
  it("names the partial and missed counts instead of the percentage", () => {
    renderTraining({ completed: 3, prescribed: 5, full: 2, partial: 1, missed: 2, pct: 60 });

    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(screen.getByText("1 partial · 2 missed")).toBeInTheDocument();
    expect(screen.queryByText("60%")).not.toBeInTheDocument();
    expect(screen.queryByText("adherence")).not.toBeInTheDocument();
  });

  it("still goes amber at 60% — the percentage drives the accent, it is just not printed", () => {
    const { container } = renderTraining({
      completed: 3, prescribed: 5, full: 2, partial: 1, missed: 2, pct: 60,
    });

    // The dot is the accent. Amber (#d97706) is "attention"; teal is good.
    const cells = container.querySelectorAll(".flex.flex-col");
    const training = cells[cells.length - 1];
    expect(training.querySelector(".bg-\\[\\#d97706\\]")).not.toBeNull();
  });

  it("says 'All complete' only when nothing was partial OR missed", () => {
    renderTraining({ completed: 5, prescribed: 5, full: 5, partial: 0, missed: 0, pct: 100 });

    expect(screen.getByText("5/5")).toBeInTheDocument();
    expect(screen.getByText("All complete")).toBeInTheDocument();
  });

  it("never says 'All complete' over a skipped session", () => {
    renderTraining({ completed: 3, prescribed: 5, full: 3, partial: 0, missed: 2, pct: 60 });

    expect(screen.getByText("2 missed")).toBeInTheDocument();
    expect(screen.queryByText("All complete")).not.toBeInTheDocument();
  });

  it("never falls back to the stored workouts_completed column", () => {
    // That column counts full completions only. With nothing prescribed there is
    // no fraction to show, and a bare count computed a different way is not the
    // same statistic — the check-in fixture carries workoutsCompleted: 3.
    renderTraining({ completed: 0, prescribed: 0, full: 0, partial: 0, missed: 0, pct: null as never });

    expect(screen.getByText("No sessions prescribed")).toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });
});
