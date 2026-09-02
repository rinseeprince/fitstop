import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { MetricHero } from "./metric-hero";
import type { MetricSummary } from "./metrics-view-types";

function metric(overrides: Partial<MetricSummary> = {}): MetricSummary {
  return {
    id: "weight",
    name: "Weight",
    tab: "body",
    unit: "kg",
    points: [],
    latest: { value: 87, date: "2026-07-27", daysAgo: 32 },
    first: { value: 90, date: "2026-07-06" },
    entryCount: 2,
    frequencyLabel: null,
    totalChange: null,
    startsOn: null,
    avgRate: null,
    change30d: null,
    week: null,
    goal: null,
    goalToGo: null,
    best: null,
    ...overrides,
  };
}

// The switcher lists whatever it is handed; its own behaviour is not under test.
const PROPS = { metrics: [metric()], onSelectMetric: vi.fn() };

beforeEach(() => cleanup());

// Total change is measured from the BASELINE — the reading as of the start
// date — and the sub-line names that reading, since its own date and source
// may not be the start date's (an intake taken nine days before it, say).
describe("MetricHero — total change", () => {
  it("names the baseline the change is measured from: its value, source and own date", () => {
    render(
      <MetricHero
        metric={metric({
          totalChange: {
            delta: -5,
            sinceDate: "2026-03-01",
            baseline: { value: 92, date: "2026-02-20", source: "intake" },
          },
        })}
        {...PROPS}
      />
    );

    expect(screen.getByText("-5.0")).toBeInTheDocument();
    expect(screen.getByText("from 92 kg · intake 20 Feb")).toBeInTheDocument();
    expect(screen.queryByText("since 1 Mar")).not.toBeInTheDocument();
  });

  it("falls back to the since-date for a change with no baseline (wellness)", () => {
    render(
      <MetricHero
        metric={metric({
          id: "sleep",
          name: "Sleep",
          tab: "wellness",
          unit: "/10",
          totalChange: { delta: 2, sinceDate: "2026-04-01" },
        })}
        {...PROPS}
      />
    );

    expect(screen.getByText("+2.0")).toBeInTheDocument();
    expect(screen.getByText("since 1 Apr")).toBeInTheDocument();
  });

  it("reads `Starts …` while the start date is ahead", () => {
    render(<MetricHero metric={metric({ totalChange: null, startsOn: "2026-10-15" })} {...PROPS} />);

    expect(screen.getByText("Starts 15 Oct")).toBeInTheDocument();
    // "Current" is still "now" — the newest reading never waits for the start.
    expect(screen.getByText("87")).toBeInTheDocument();
  });
});
