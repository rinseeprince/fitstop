import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import {
  HabitsDetail,
  NutritionDetail,
  TrainingDetail,
  WellnessDetail,
} from "./signal-details";
import { addDaysToDateString } from "@/lib/date-helpers";
import type { AttentionAlert } from "@/types/attention-feed";
import type { AdherenceSummary, DotState, HabitBreakdown } from "@/types/coach-overview";
import type { DailyLog } from "@/types/daily-log";

function windowDates(days: number, start = "2026-07-06"): string[] {
  return Array.from({ length: days }, (_, i) => addDaysToDateString(start, i));
}

beforeEach(() => cleanup());

describe("TrainingDetail — the day strip", () => {
  it("renders one cell per day, and a dash rather than a dot where nothing was planned", () => {
    const dates = windowDates(7);
    const rail: DotState[] = [
      "complete",
      "none",
      "partial",
      "missed",
      "none",
      "complete",
      "no_log",
    ];

    const { container } = render(<TrainingDetail dates={dates} rail={rail} />);

    const grid = container.querySelector<HTMLElement>('[style*="grid-template-columns"]');
    expect(grid?.style.gridTemplateColumns).toBe("repeat(7, minmax(0, 1fr))");
    expect(grid?.children).toHaveLength(7);

    // 'none' means no session was planned — a dash. Rendering it as a missed
    // dot turns every rest day into a failure.
    expect(container.querySelectorAll(".rounded-full")).toHaveLength(5);
  });

  it("wraps into weeks above three weeks rather than shrinking to slivers", () => {
    // 2026-07-06 is a Monday, so a 30-day window pads one leading blank to put
    // Sunday in column 0 and then runs whole weeks.
    const dates = windowDates(30);
    const rail: DotState[] = dates.map(() => "complete");

    const { container } = render(<TrainingDetail dates={dates} rail={rail} />);

    const grids = container.querySelectorAll<HTMLElement>('[style*="grid-template-columns"]');
    expect(grids[0].style.gridTemplateColumns).toBe("repeat(7, minmax(0, 1fr))");
    // 30 days + 1 leading pad so the columns stay weekday-aligned.
    expect(grids[0].children).toHaveLength(31);
    // One weekday label row serves every week, not one repeat per week.
    expect(grids[1].children).toHaveLength(7);
  });

  it("keeps a single row at 21 days or fewer", () => {
    const dates = windowDates(14);
    const { container } = render(
      <TrainingDetail dates={dates} rail={dates.map(() => "complete")} />
    );

    const grid = container.querySelector<HTMLElement>('[style*="grid-template-columns"]');
    expect(grid?.style.gridTemplateColumns).toBe("repeat(14, minmax(0, 1fr))");
  });
});

describe("NutritionDetail", () => {
  const nutrition: AdherenceSummary["nutrition"] = {
    rail: [],
    onTarget: 3,
    loggedDays: 9,
    pct: 30,
    calories: { actual: 2940, target: 3552, days: 6 },
    protein: { actual: 148, target: 211, days: 6 },
  };

  it("states the day count behind the mean, which is NOT the days logged", () => {
    render(<NutritionDetail nutrition={nutrition} />);

    // A day logged before a plan existed carries a null target and is excluded
    // from both means — so 9 days logged, 6 days averaged.
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("target 3552 · over 6 days")).toBeInTheDocument();
    expect(screen.getByText("target 211g · over 6 days")).toBeInTheDocument();
  });

  it("says so plainly when no day carried both an intake and a target", () => {
    render(
      <NutritionDetail nutrition={{ ...nutrition, calories: null, protein: null }} />
    );

    expect(
      screen.getAllByText("No day carried both an intake and a target")
    ).toHaveLength(2);
  });
});

describe("HabitsDetail", () => {
  const habits: HabitBreakdown[] = [
    {
      id: "h1",
      name: "Water",
      eligibleDays: 7,
      completedDays: 5,
      pct: 71,
      rail: [true, true, false, false, true, true, true],
    },
    {
      id: "h2",
      name: "Steps",
      eligibleDays: 7,
      completedDays: 0,
      pct: 0,
      rail: [false, false, false, false, false, false, false],
    },
  ];

  it("keeps a habit the client never logged, at 0% rather than absent", () => {
    render(<HabitsDetail perHabit={habits} />);

    expect(screen.getByText("Steps")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("0 of 7 days")).toBeInTheDocument();
  });

  it("scores each habit over its OWN eligible days", () => {
    render(<HabitsDetail perHabit={habits} />);

    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.getByText("5 of 7 days")).toBeInTheDocument();
  });

  it("marks a habit added after the window rather than scoring it zero", () => {
    render(
      <HabitsDetail
        perHabit={[
          {
            id: "h3",
            name: "Stretch",
            eligibleDays: 0,
            completedDays: 0,
            pct: null,
            rail: [null, null, null],
          },
        ]}
      />
    );

    expect(screen.getByText("Added after this window")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("says so when the client has no habits at all", () => {
    render(<HabitsDetail perHabit={[]} />);

    expect(screen.getByText("No habits are active for this client.")).toBeInTheDocument();
  });
});

describe("WellnessDetail", () => {
  const dates = windowDates(3);
  const logs = [
    { id: "d1", clientId: "c1", date: dates[2], mood: 4, energy: 6, sleep: 5, stress: 8, soreness: 7 },
  ] as DailyLog[];

  function alert(type: AttentionAlert["type"], days: string[]): AttentionAlert {
    return { type, severity: "high", message: "…", affectedDays: days, metricData: [] };
  }

  it("renders all five metrics, Soreness included", () => {
    render(<WellnessDetail logs={logs} dates={dates} attentionAlerts={[]} />);

    for (const name of ["Mood", "Energy", "Sleep quality", "Stress", "Soreness"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("words the flag as an ALERT, not as a statistic about this panel", () => {
    // The trigger counts affected days over its OWN fixed window while the
    // figures beneath follow the selected one; "Flagged" is what stops the two
    // reading as one number disagreeing with itself.
    render(
      <WellnessDetail
        logs={logs}
        dates={dates}
        attentionAlerts={[alert("high_stress", ["2026-07-06", "2026-07-07", "2026-07-08"])]}
      />
    );

    expect(screen.getByText(/Flagged: high for/)).toBeInTheDocument();
    expect(screen.getByText("3 days")).toBeInTheDocument();
  });

  it("never flags sleep — no trigger evaluates it", () => {
    render(
      <WellnessDetail
        logs={logs}
        dates={dates}
        attentionAlerts={[alert("high_stress", ["2026-07-08"])]}
      />
    );

    expect(screen.getAllByText(/Flagged:/)).toHaveLength(1);
  });

  it("says a metric was not logged in THIS window, not 'this week'", () => {
    render(<WellnessDetail logs={[]} dates={dates} attentionAlerts={[]} />);

    expect(screen.getAllByText("Not logged in this window")).toHaveLength(5);
  });
});
