import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MetricProgressionSection } from "./metric-progression-section";
import type { MetricSummary } from "./metrics-view-types";

const NO_ENTRIES = { average: null, count: 0 };

function empty(id: string, name: string, tab: MetricSummary["tab"], unit: string): MetricSummary {
  return {
    id,
    name,
    tab,
    unit,
    points: [],
    latest: null,
    first: null,
    entryCount: 0,
    totalChange: null,
    startsOn: null,
    avgRate: null,
    lastWeek: { days: 7, current: NO_ENTRIES, previous: NO_ENTRIES, change: null },
    lastMonth: { days: 30, current: NO_ENTRIES, previous: NO_ENTRIES, change: null },
    cardThree:
      tab === "wellness"
        ? { kind: "lowest", worst: null }
        : { kind: "last90", comparison: { days: 90, current: NO_ENTRIES, previous: NO_ENTRIES, change: null } },
    goal: null,
  };
}

beforeEach(() => cleanup());

// A metric with no entries: the section collapses to one quiet card. A coach
// logs a body measurement; a wellness score is the client's own log.
describe("MetricProgressionSection — no entries yet", () => {
  it("invites the first entry for a physique metric", async () => {
    const user = userEvent.setup();
    const onLogFirst = vi.fn();
    render(
      <MetricProgressionSection
        metric={empty("waist", "Waist", "body", "cm")}
        range={30}
        onRangeChange={vi.fn()}
        onLogFirst={onLogFirst}
      />
    );

    expect(screen.getByText("No Waist entries yet")).toBeInTheDocument();
    expect(screen.getByText("Entries from check-ins and coach logs will chart here.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log the first entry" }));
    expect(onLogFirst).toHaveBeenCalledTimes(1);
  });

  it("says where a wellness score comes from, and offers nothing to log", () => {
    render(
      <MetricProgressionSection
        metric={empty("sleep", "Sleep", "wellness", "/10")}
        range={30}
        onRangeChange={vi.fn()}
        onLogFirst={vi.fn()}
      />
    );

    expect(screen.getByText("No Sleep entries yet")).toBeInTheDocument();
    expect(screen.getByText("The client's daily logs will chart here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log the first entry" })).not.toBeInTheDocument();
  });
});
