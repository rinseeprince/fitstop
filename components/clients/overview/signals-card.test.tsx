import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SignalsCard } from "./signals-card";
import type { AlertType, AttentionAlert } from "@/types/attention-feed";
import type { AdherenceSummary, DotState } from "@/types/coach-overview";
import type { DailyLog } from "@/types/daily-log";

const DATES = [
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
  "2026-07-23",
  "2026-07-24",
  "2026-07-25",
  "2026-07-26",
];

function rail(...states: DotState[]): DotState[] {
  return states;
}

const SUMMARY: AdherenceSummary = {
  dates: DATES,
  training: {
    rail: rail("complete", "none", "partial", "missed", "none", "complete", "no_log"),
    completed: 2,
    planned: 5,
    pct: 40,
  },
  nutrition: {
    rail: rail("complete", "complete", "partial", "missed", "no_log", "complete", "no_log"),
    onTarget: 3,
    loggedDays: 5,
    pct: 43,
    calories: { actual: 2100, target: 2000, days: 4 },
    protein: { actual: 140, target: 150, days: 4 },
  },
  habits: {
    rail: rail("complete", "partial", "partial", "missed", "no_log", "complete", "complete"),
    avgPct: 71,
    daysBelow50: 2,
    perHabit: [
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
    ],
  },
};

const LOGS: DailyLog[] = [
  { id: "d1", clientId: "c1", date: "2026-07-26", mood: 4, energy: 6 } as DailyLog,
];

function alert(type: AlertType, affectedDays: string[]): AttentionAlert {
  return { type, severity: "high", message: "…", affectedDays, metricData: [] };
}

const PROPS = {
  adherence: SUMMARY,
  isAdherenceLoading: false,
  wellnessLogs: LOGS,
  isWellnessLoading: false,
  dates: DATES,
  attentionAlerts: [] as AttentionAlert[],
  windowDays: 30 as const,
  onTabChange: vi.fn(),
};

beforeEach(() => cleanup());

describe("SignalsCard", () => {
  it("states the selected window on the rail", () => {
    render(<SignalsCard {...PROPS} />);
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();

    cleanup();
    render(<SignalsCard {...PROPS} windowDays={60} />);
    expect(screen.getByText("Last 60 days")).toBeInTheDocument();
  });

  it("shows each row's percentage and plain-language sub-line", () => {
    render(<SignalsCard {...PROPS} />);

    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("2 of 5 sessions completed")).toBeInTheDocument();
    expect(screen.getByText("3 on target · 5 days logged")).toBeInTheDocument();
    expect(screen.getByText("2 days below 50%")).toBeInTheDocument();
  });

  it("gives Wellness NO percentage and no bar — there is no composite score", () => {
    render(<SignalsCard {...PROPS} />);

    const wellnessRow = screen.getByText("Wellness").closest("button");
    expect(wellnessRow).not.toBeNull();
    // The three real percentages render; the wellness row carries none, and
    // does not fall back to an em-dash either (that means "no data").
    expect(within(wellnessRow as HTMLElement).queryByText("%")).not.toBeInTheDocument();
    expect(within(wellnessRow as HTMLElement).queryByText("—")).not.toBeInTheDocument();
  });

  it("falls back to an em-dash when a real rail has no percentage", () => {
    render(
      <SignalsCard
        {...PROPS}
        adherence={{
          ...SUMMARY,
          training: { rail: SUMMARY.training.rail, completed: 0, planned: 0, pct: null },
        }}
      />
    );

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("No sessions planned in this window")).toBeInTheDocument();
  });

  it("counts the flagged wellness metrics on the row", () => {
    render(
      <SignalsCard
        {...PROPS}
        attentionAlerts={[
          alert("high_stress", ["2026-07-25", "2026-07-26"]),
          alert("mood_drop", ["2026-07-26"]),
          // Routes to nutrition, not a wellness metric — must not be counted.
          alert("nutrition_missed", ["2026-07-24"]),
        ]}
      />
    );

    expect(screen.getByText("2 metrics flagged")).toBeInTheDocument();
  });

  it("keeps the adherence error state", () => {
    render(<SignalsCard {...PROPS} adherence={null} isAdherenceLoading={false} />);

    expect(screen.getByText("Adherence could not be loaded.")).toBeInTheDocument();
  });

  it("does not claim an error while the first fetch is still running", () => {
    render(<SignalsCard {...PROPS} adherence={null} isAdherenceLoading />);

    expect(screen.queryByText("Adherence could not be loaded.")).not.toBeInTheDocument();
  });

  it("keeps every panel closed until it is asked for", () => {
    render(<SignalsCard {...PROPS} />);

    expect(screen.queryByText("Session by session")).not.toBeInTheDocument();
    expect(screen.queryByText("Avg calories")).not.toBeInTheDocument();
  });

  it("opens a row's detail and offers the tab that owns it", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<SignalsCard {...PROPS} onTabChange={onTabChange} />);

    await user.click(screen.getByText("Nutrition"));
    expect(screen.getByText("Avg calories")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Nutrition" }));
    expect(onTabChange).toHaveBeenCalledWith("nutrition");
  });

  it("opens each of the four panels", async () => {
    const user = userEvent.setup();
    render(<SignalsCard {...PROPS} />);

    await user.click(screen.getByText("Training"));
    expect(screen.getByText("Session by session")).toBeInTheDocument();

    await user.click(screen.getByText("Habits"));
    expect(screen.getByText("Water")).toBeInTheDocument();

    await user.click(screen.getByText("Wellness"));
    expect(screen.getByText("Sleep quality")).toBeInTheDocument();
  });
});
