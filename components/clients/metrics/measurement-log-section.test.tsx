import { describe, it, expect, beforeEach, vi } from "vitest";
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
    canonicalValue: value,
    change: null,
    note: null,
    source: "check_in",
    sourceId: null,
    isMeasurement: true,
    voided: null,
    isCurrent: false,
    isBaseline: false,
    beforeStart: false,
    ...overrides,
  };
}

// The section reads two fields of the selected metric: the id it filters on
// and the name it prints.
const WEIGHT = { id: "weight", name: "Weight" };
const WAIST = { id: "waist", name: "Waist" };
const MOOD = { id: "mood", name: "Mood" };

// Twelve weekly journey readings from the start date, newest first — one full
// page and two over.
const JOURNEY: LogRow[] = Array.from({ length: 12 }, (_, i) => {
  const week = 11 - i;
  return row(`m-${week + 1}`, addDaysToDate("2026-03-01", week * 7), 90 - week * 0.5);
});

/** An intake taken before the start: the client's, but not the journey's. */
const BEFORE_START = row("m-0", "2026-02-20", 92, { beforeStart: true, source: "intake" });

// Three waist readings and one before the start — every value distinct from
// every weight above, so a leak across metrics is a visible number.
const waist = (id: string, date: string, value: number, overrides: Partial<LogRow> = {}) =>
  row(id, date, value, { metricId: "waist", metricName: "Waist", unit: "cm", ...overrides });
const WAIST_ROWS: LogRow[] = [
  waist("w-3", "2026-05-10", 79.1),
  waist("w-2", "2026-04-12", 79.7),
  waist("w-1", "2026-03-15", 80.2),
];
const WAIST_BEFORE_START = waist("w-0", "2026-02-18", 81.6, { beforeStart: true, source: "intake" });

const wellness = (metricId: string, metricName: string, unit: string, date: string, value: number) =>
  row(`${metricId}|${date}`, date, value, { metricId, metricName, unit, isMeasurement: false });

const tablesOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("table"));
const bodyRowsOf = (table: HTMLElement) => table.querySelectorAll("tbody tr");

beforeEach(() => cleanup());

// docs/MEASUREMENT-LOG-PLAN.md commit 6: the log is the SELECTED metric's —
// the hero's switcher drives the hero, the chart and the log — and the pager
// counts that metric's entries (D12–D15). The page's return to 1 on a switch
// is the host's key, under metrics-tab-content.test.tsx.
describe("MeasurementLogSection — the selected metric", () => {
  it("lists the selected metric's rows only, and the pager counts only them", () => {
    const rows = [...JOURNEY, ...WAIST_ROWS];
    const { container, rerender } = render(<MeasurementLogSection metric={WEIGHT} rows={rows} />);

    expect(screen.getByText("Showing 10 of 12 weight entries")).toBeInTheDocument();
    expect(bodyRowsOf(tablesOf(container)[0])).toHaveLength(10);
    expect(screen.queryByText("79.1")).not.toBeInTheDocument();

    rerender(<MeasurementLogSection metric={WAIST} rows={rows} />);
    expect(screen.getByText("Showing 3 of 3 waist entries")).toBeInTheDocument();
    expect(bodyRowsOf(tablesOf(container)[0])).toHaveLength(3);
    expect(screen.getByText("79.1")).toBeInTheDocument();
    expect(screen.getByText("79.7")).toBeInTheDocument();
    expect(screen.getByText("80.2")).toBeInTheDocument();
    expect(screen.queryByText("90")).not.toBeInTheDocument();
  });

  it("filters the Before-start rail too", () => {
    const rows = [...JOURNEY, BEFORE_START, ...WAIST_ROWS, WAIST_BEFORE_START];
    const { container, rerender } = render(<MeasurementLogSection metric={WEIGHT} rows={rows} />);

    let [, beforeStart] = tablesOf(container);
    expect(bodyRowsOf(beforeStart)).toHaveLength(1);
    expect(within(beforeStart).getByText("20 February")).toBeInTheDocument();
    expect(within(beforeStart).queryByText("18 February")).not.toBeInTheDocument();

    rerender(<MeasurementLogSection metric={WAIST} rows={rows} />);
    [, beforeStart] = tablesOf(container);
    expect(bodyRowsOf(beforeStart)).toHaveLength(1);
    expect(within(beforeStart).getByText("18 February")).toBeInTheDocument();
    expect(within(beforeStart).queryByText("20 February")).not.toBeInTheDocument();
  });

  it("names the metric in the empty state, with no pager and no rail", () => {
    render(<MeasurementLogSection metric={WAIST} rows={[...JOURNEY, BEFORE_START]} />);

    expect(screen.getByText("No Waist entries yet")).toBeInTheDocument();
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();
    expect(screen.queryByText("Before start")).not.toBeInTheDocument();
  });

  it("has no Metric column — the switcher above names it, every value carries its unit", () => {
    const { container } = render(<MeasurementLogSection metric={WEIGHT} rows={JOURNEY} />);

    const headers = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).not.toContain("Metric");
    // Date, Day, Value, Change, Notes, and the actions cell.
    expect(headers).toHaveLength(6);
  });

  it("filters a wellness metric the same way", () => {
    const rows = [
      wellness("mood", "Mood", "/5", "2026-08-14", 4),
      wellness("sleep", "Sleep", "/10", "2026-08-14", 7),
      wellness("mood", "Mood", "/5", "2026-08-07", 3),
    ];
    const { container } = render(<MeasurementLogSection metric={MOOD} rows={rows} />);

    expect(screen.getByText("Showing 2 of 2 mood entries")).toBeInTheDocument();
    expect(bodyRowsOf(tablesOf(container)[0])).toHaveLength(2);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("7")).not.toBeInTheDocument();
  });
});

describe("MeasurementLogSection — readings before the start", () => {
  it("lists a reading dated before the start under its own rail, not in the log", () => {
    const { container } = render(
      <MeasurementLogSection metric={WEIGHT} rows={[...JOURNEY, BEFORE_START]} />
    );

    expect(screen.getByText("Before start")).toBeInTheDocument();
    const [log, beforeStart] = tablesOf(container);
    expect(within(beforeStart).getByText("20 February")).toBeInTheDocument();
    expect(within(log).queryByText("20 February")).not.toBeInTheDocument();
  });

  it("pages the journey alone — the pre-start reading is neither counted nor paged", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MeasurementLogSection metric={WEIGHT} rows={[...JOURNEY, BEFORE_START]} />
    );

    // Twelve, not thirteen.
    expect(screen.getByText("Showing 10 of 12 weight entries")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    const [log, beforeStart] = tablesOf(container);
    expect(bodyRowsOf(log)).toHaveLength(2);
    expect(within(log).queryByText("20 February")).not.toBeInTheDocument();
    // Unpaged: still there on the second page.
    expect(within(beforeStart).getByText("20 February")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 12 weight entries")).toBeInTheDocument();
  });

  it("draws no rail when every reading is in the journey", () => {
    const { container } = render(<MeasurementLogSection metric={WEIGHT} rows={JOURNEY} />);

    expect(screen.queryByText("Before start")).not.toBeInTheDocument();
    expect(tablesOf(container)).toHaveLength(1);
  });
});

// docs/MEASUREMENT-LOG-PLAN.md commit 4: the log lists EVERY reading, and a
// removed one stays listed, muted, with who removed it and when.
describe("MeasurementLogSection — every reading, removed ones muted", () => {
  const SAME_DAY: LogRow[] = [
    row("m-coach", "2026-08-14", 90, { source: "coach_entry", isCurrent: true }),
    row("m-checkin", "2026-08-14", 91, { source: "check_in", sourceId: "ci-1" }),
  ];

  it("lists two readings of one day as two rows", () => {
    const { container } = render(<MeasurementLogSection metric={WEIGHT} rows={SAME_DAY} />);

    const [log] = tablesOf(container);
    expect(bodyRowsOf(log)).toHaveLength(2);
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2 weight entries")).toBeInTheDocument();
  });

  it("mutes a removed reading and names who removed it and when", () => {
    const { container } = render(
      <MeasurementLogSection
        metric={WEIGHT}
        rows={[
          row("m-live", "2026-08-21", 89),
          row("m-gone", "2026-08-14", 91, {
            voided: { at: "2026-09-03T10:00:00+00:00", byName: "Sam Kalepa" },
          }),
        ]}
      />
    );

    const [log] = tablesOf(container);
    const [live, removed] = Array.from(bodyRowsOf(log)) as HTMLElement[];
    expect(removed.className).toContain("opacity-60");
    expect(live.className).not.toContain("opacity-60");
    expect(within(removed).getByText(/Removed by Sam Kalepa/)).toBeInTheDocument();
    expect(within(removed).getByText("3 Sept")).toBeInTheDocument();
  });

  it("says 'Removed' alone when the remover is no longer known", () => {
    render(
      <MeasurementLogSection
        metric={WEIGHT}
        rows={[row("m-gone", "2026-08-14", 91, { voided: { at: "2026-09-03T10:00:00+00:00", byName: null } })]}
      />
    );

    expect(screen.getByText(/^Removed$/)).toBeInTheDocument();
  });
});

describe("MeasurementLogSection — the three row actions", () => {
  const LIVE = row("m-live", "2026-08-21", 89, { sourceId: "ci-9" });
  const REMOVED = row("m-gone", "2026-08-14", 91, {
    voided: { at: "2026-09-03T10:00:00+00:00", byName: "Sam Kalepa" },
  });

  it("offers Edit and Remove on a live reading, Restore alone on a removed one", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const onRestore = vi.fn();
    render(
      <MeasurementLogSection
        metric={WEIGHT}
        rows={[LIVE, REMOVED]}
        onEditReading={onEdit}
        onRemoveReading={onRemove}
        onRestoreReading={onRestore}
      />
    );

    expect(screen.getAllByRole("button", { name: "Edit reading" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Remove reading" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Restore reading" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Edit reading" }));
    expect(onEdit).toHaveBeenCalledWith(LIVE);
    await user.click(screen.getByRole("button", { name: "Remove reading" }));
    expect(onRemove).toHaveBeenCalledWith(LIVE);
    await user.click(screen.getByRole("button", { name: "Restore reading" }));
    expect(onRestore).toHaveBeenCalledWith(REMOVED);
  });

  it("holds Restore while that row's restore is in flight", () => {
    render(
      <MeasurementLogSection
        metric={WEIGHT}
        rows={[REMOVED]}
        onRestoreReading={vi.fn()}
        pendingRowId={REMOVED.id}
      />
    );

    expect(screen.getByRole("button", { name: "Restore reading" })).toBeDisabled();
  });

  it("gives a wellness entry no action, and the Wellness pane no actions column", () => {
    const entry = wellness("mood", "Mood", "/5", "2026-08-14", 4);
    const { container } = render(
      <MeasurementLogSection
        metric={MOOD}
        rows={[entry]}
        onEditReading={vi.fn()}
        onRemoveReading={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /reading/ })).not.toBeInTheDocument();
    // Five columns — Date, Day, Value, Change, Notes — and no sixth.
    expect(container.querySelectorAll("thead th")).toHaveLength(5);
  });
});
