import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

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
    totalChange: null,
    startsOn: null,
    avgRate: null,
    lastWeek: { days: 7, current: null, previous: null, change: null },
    lastMonth: { days: 30, current: null, previous: null, change: null },
    cardThree: { kind: "goal", goal: { status: "none" } },
    goal: null,
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
            kind: "sinceStart",
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

  // A wellness score's change runs from the client's first week of entries to
  // the last 7 days (D32), and says which week it started from.
  it("dates a wellness change by the week it runs from", () => {
    render(
      <MetricHero
        metric={metric({
          id: "sleep",
          name: "Sleep",
          tab: "wellness",
          unit: "/10",
          totalChange: { kind: "firstWeek", delta: 1.6, firstWeekOf: "2026-04-01" },
        })}
        {...PROPS}
      />
    );

    expect(screen.getByText("+1.6")).toBeInTheDocument();
    expect(screen.getByText("since the week of 1 Apr")).toBeInTheDocument();
  });

  it("says so when a week holds too few entries to average", () => {
    render(
      <MetricHero
        metric={metric({
          id: "sleep",
          name: "Sleep",
          tab: "wellness",
          unit: "/10",
          totalChange: { kind: "notEnoughEntries" },
        })}
        {...PROPS}
      />
    );

    expect(screen.getByText("Not enough entries")).toBeInTheDocument();
    expect(screen.queryByText(/since the week of/)).not.toBeInTheDocument();
  });

  it("says it is too soon while the client's first week and the last 7 days share a day", () => {
    render(
      <MetricHero
        metric={metric({
          id: "sleep",
          name: "Sleep",
          tab: "wellness",
          unit: "/10",
          totalChange: { kind: "tooSoon" },
        })}
        {...PROPS}
      />
    );

    expect(screen.getByText("Too soon to compare")).toBeInTheDocument();
    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
  });

  // An empty cell keeps the line its number would take, so the line under the
  // dash sits level with the neighbouring cells' (smoke, 2026-09-24).
  it("draws an empty cell's dash inside a number line, the same as its neighbour's", () => {
    render(
      <MetricHero
        metric={metric({
          id: "sleep",
          name: "Sleep",
          tab: "wellness",
          unit: "/10",
          totalChange: { kind: "tooSoon" },
        })}
        {...PROPS}
      />
    );

    const totalChangeCell = screen.getByText("Total change").parentElement!;
    const dashLine = within(totalChangeCell).getByText("—").closest("p");
    // The Entries cell beside it holds the fixture's 2 entries
    const entriesLine = screen.getByText("2").closest("p");
    expect(dashLine?.className).toBe(entriesLine?.className);
  });

  // Current's number is a size up; its line is not, or the line under it
  // drops below its neighbours' (smoke, 2026-09-24).
  it("gives every cell's number line one height, so the lines under the numbers sit level", () => {
    render(
      <MetricHero
        metric={metric({
          id: "sleep",
          name: "Sleep",
          tab: "wellness",
          unit: "/10",
          totalChange: { kind: "firstWeek", delta: 1.3, firstWeekOf: "2026-04-01" },
        })}
        {...PROPS}
      />
    );

    const lineHeight = (text: string) =>
      screen.getByText(text).closest("p")?.className.match(/leading-\S+/)?.[0];
    expect(lineHeight("87")).toBeDefined();
    expect(lineHeight("+1.3")).toBe(lineHeight("87"));
    expect(lineHeight("2")).toBe(lineHeight("87"));
  });

  it("draws no tag pills beside the switcher — no unit, frequency or entry-count chip", () => {
    const { container } = render(<MetricHero metric={metric({ entryCount: 15 })} {...PROPS} />);

    expect(screen.queryByText("15 entries")).not.toBeInTheDocument();
    expect(screen.queryByText(/entr(y|ies)$/)).not.toBeInTheDocument();
    // The header row holds the switcher trigger and nothing beside it.
    const header = container.querySelector(".border-b");
    expect(header?.children).toHaveLength(1);
  });

  it("reads `Starts …` while the start date is ahead", () => {
    render(<MetricHero metric={metric({ totalChange: null, startsOn: "2026-10-15" })} {...PROPS} />);

    expect(screen.getByText("Starts 15 Oct")).toBeInTheDocument();
    // "Current" is still "now" — the newest reading never waits for the start.
    expect(screen.getByText("87")).toBeInTheDocument();
  });
});
