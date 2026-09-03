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

// docs/MEASUREMENT-LOG-PLAN.md commit 4: the log lists EVERY reading, and a
// removed one stays listed, muted, with who removed it and when.
describe("MeasurementLogSection — every reading, removed ones muted", () => {
  const SAME_DAY: LogRow[] = [
    row("m-coach", "2026-08-14", 90, { source: "coach_entry", isCurrent: true }),
    row("m-checkin", "2026-08-14", 91, { source: "check_in", sourceId: "ci-1" }),
  ];

  it("lists two readings of one day as two rows", () => {
    const { container } = render(<MeasurementLogSection rows={SAME_DAY} />);

    const [log] = tablesOf(container);
    expect(bodyRowsOf(log)).toHaveLength(2);
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("91")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2 entries")).toBeInTheDocument();
  });

  it("mutes a removed reading and names who removed it and when", () => {
    const { container } = render(
      <MeasurementLogSection
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
      <MeasurementLogSection rows={[REMOVED]} onRestoreReading={vi.fn()} pendingRowId={REMOVED.id} />
    );

    expect(screen.getByRole("button", { name: "Restore reading" })).toBeDisabled();
  });

  it("gives a wellness entry no action, and the Wellness pane no actions column", () => {
    const entry = row("mood|2026-08-14", "2026-08-14", 4, {
      metricId: "mood",
      metricName: "Mood",
      unit: "/5",
      isMeasurement: false,
    });
    const { container } = render(
      <MeasurementLogSection rows={[entry]} onEditReading={vi.fn()} onRemoveReading={vi.fn()} />
    );

    expect(screen.queryByRole("button", { name: /reading/ })).not.toBeInTheDocument();
    // Six columns — Date, Day, Metric, Value, Change, Notes — and no seventh.
    expect(container.querySelectorAll("thead th")).toHaveLength(6);
  });

  it("keeps a wellness entry action-free even beside a physique reading (the cell's own guard)", () => {
    const entry = row("mood|2026-08-14", "2026-08-14", 4, {
      metricId: "mood",
      metricName: "Mood",
      unit: "/5",
      isMeasurement: false,
    });
    const { container } = render(
      <MeasurementLogSection rows={[LIVE, entry]} onEditReading={vi.fn()} onRemoveReading={vi.fn()} />
    );

    const [log] = tablesOf(container);
    const [physique, wellness] = Array.from(bodyRowsOf(log)) as HTMLElement[];
    expect(within(physique).getByRole("button", { name: "Edit reading" })).toBeInTheDocument();
    expect(within(wellness).queryByRole("button")).not.toBeInTheDocument();
  });
});
