import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MeasurementLogSection } from "./measurement-log-section";
import { addDaysToDate } from "@/utils/metric-points";
import type { LogRow } from "./metrics-view-types";

function row(
  id: string,
  date: string,
  value: number,
  overrides: Partial<LogRow> = {}
): LogRow {
  return {
    id,
    date,
    metricId: "weight",
    metricName: "Weight",
    value,
    unit: "kg",
    change: null,
    note: null,
    source: "check_in",
    beforeStart: false,
    ...overrides,
  };
}

// Twelve weekly journey readings from the start date, newest first — one full
// page and two over.
const JOURNEY: LogRow[] = Array.from({ length: 12 }, (_, i) => {
  const week = 11 - i;
  return row(`m-${week + 1}`, addDaysToDate("2026-03-01", week * 7), 90 - week * 0.5);
});

/** An intake taken before the start: the client's, but not the journey's. */
const BEFORE_START = row("m-0", "2026-02-20", 92, { beforeStart: true, source: "intake" });

const tablesOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("table"));
const bodyRowsOf = (table: HTMLElement) => table.querySelectorAll("tbody tr");

beforeEach(() => cleanup());

describe("MeasurementLogSection — readings before the start", () => {
  it("lists a reading dated before the start under its own rail, not in the log", () => {
    const { container } = render(<MeasurementLogSection rows={[...JOURNEY, BEFORE_START]} />);

    expect(screen.getByText("Before start")).toBeInTheDocument();
    const [log, beforeStart] = tablesOf(container);
    expect(within(beforeStart).getByText("20 February")).toBeInTheDocument();
    expect(within(log).queryByText("20 February")).not.toBeInTheDocument();
  });

  it("pages the journey alone — the pre-start reading is neither counted nor paged", async () => {
    const user = userEvent.setup();
    const { container } = render(<MeasurementLogSection rows={[...JOURNEY, BEFORE_START]} />);

    // Twelve, not thirteen.
    expect(screen.getByText("Showing 10 of 12 entries")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    const [log, beforeStart] = tablesOf(container);
    expect(bodyRowsOf(log)).toHaveLength(2);
    expect(within(log).queryByText("20 February")).not.toBeInTheDocument();
    // Unpaged: still there on the second page.
    expect(within(beforeStart).getByText("20 February")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 12 entries")).toBeInTheDocument();
  });

  it("draws no rail when every reading is in the journey", () => {
    const { container } = render(<MeasurementLogSection rows={JOURNEY} />);

    expect(screen.queryByText("Before start")).not.toBeInTheDocument();
    expect(tablesOf(container)).toHaveLength(1);
  });
});
