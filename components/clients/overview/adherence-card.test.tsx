import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdherenceCard } from "./adherence-card";
import type { AdherenceSummary, DotState } from "@/types/coach-overview";

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
  loggedDates: ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-25", "2026-07-26"],
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
  },
  habits: {
    rail: rail("complete", "partial", "partial", "missed", "no_log", "complete", "complete"),
    avgPct: 71,
    daysBelow50: 2,
    // The card renders the three RAILS, never the per-habit cut — that is the
    // check-in review's reader. Empty here on purpose: a value would suggest
    // this card had an opinion about it. (The Signals card that did render it
    // is rejected; see project_overview_v2_workstream.)
    perHabit: [],
  },
};

const PROPS = { isLoading: false, windowDays: 14 };

beforeEach(() => cleanup());

describe("AdherenceCard", () => {
  it("renders all three rails over the same dates, so the dot columns align", () => {
    const { container } = render(
      <AdherenceCard adherence={SUMMARY} onTabChange={vi.fn()} {...PROPS} />
    );

    const rails = container.querySelectorAll<HTMLElement>('[style*="grid-template-columns"]');
    expect(rails).toHaveLength(3);
    for (const el of rails) {
      expect(el.style.gridTemplateColumns).toBe(`repeat(${DATES.length}, minmax(0, 1fr))`);
      expect(el.children).toHaveLength(DATES.length);
    }
  });

  it("labels every dot column with its weekday initial", () => {
    render(<AdherenceCard adherence={SUMMARY} onTabChange={vi.fn()} {...PROPS} />);

    // Three rails x seven days; every column carries an initial.
    expect(screen.getAllByText("M")).toHaveLength(3);
    expect(screen.getAllByText("S")).toHaveLength(6);
  });

  it("shows each rail's percentage and plain-language sub-line", () => {
    render(<AdherenceCard adherence={SUMMARY} onTabChange={vi.fn()} {...PROPS} />);

    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("2 of 5 sessions completed")).toBeInTheDocument();
    expect(screen.getByText("3 on target · 5 days logged")).toBeInTheDocument();
    expect(screen.getByText("2 days below 50%")).toBeInTheDocument();
  });

  it("falls back to an em-dash when a rail has no percentage", () => {
    render(
      <AdherenceCard
        adherence={{
          ...SUMMARY,
          training: { rail: SUMMARY.training.rail, completed: 0, planned: 0, pct: null },
        }}
        onTabChange={vi.fn()}
        {...PROPS}
      />
    );

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("No sessions planned in this window")).toBeInTheDocument();
  });

  it("sends each row to the tab that owns its data", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<AdherenceCard adherence={SUMMARY} onTabChange={onTabChange} {...PROPS} />);

    await user.click(screen.getByRole("button", { name: "Open Training" }));
    await user.click(screen.getByRole("button", { name: "Open Nutrition" }));
    await user.click(screen.getByRole("button", { name: "Open Habits" }));

    expect(onTabChange.mock.calls.map(([tab]) => tab)).toEqual([
      "training",
      "nutrition",
      "daily-habits",
    ]);
  });

  it("states the window length in the section meta", () => {
    render(<AdherenceCard adherence={SUMMARY} onTabChange={vi.fn()} {...PROPS} />);
    expect(screen.getByText("Last 14 days")).toBeInTheDocument();
  });
});
