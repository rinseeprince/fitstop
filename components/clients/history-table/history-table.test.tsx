import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HistoryTable, type ColumnDef } from "./history-table";

type Row = { day: string };
const columns: ColumnDef<Row>[] = [
  { key: "day", label: "Day", render: (value) => <span>{String(value)}</span> },
];

function renderTable(props: Partial<React.ComponentProps<typeof HistoryTable<Row>>> = {}) {
  return render(
    <HistoryTable<Row>
      columns={columns}
      data={[]}
      isLoading={false}
      emptyMessage="No data logged yet"
      {...props}
    />
  );
}

/**
 * The branch order is the invariant (newdesignsystem → "Loading & async
 * states"): the empty state is a statement about the data, so it must be
 * unreachable from a failed read — useHistoryData blanks rows on error, which
 * is exactly how every consumer used to fall through to "No data logged yet".
 */
describe("HistoryTable", () => {
  it("renders the error, not the empty state, when the read failed", () => {
    const onRetry = vi.fn();
    renderTable({ isError: true, errorMessage: "Could not load this history", onRetry });

    expect(screen.getByText("Could not load this history")).toBeInTheDocument();
    expect(screen.queryByText("No data logged yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state only for a settled, empty result", () => {
    renderTable();
    expect(screen.getByText("No data logged yet")).toBeInTheDocument();
  });

  it("prefers skeleton rows while loading, whatever else is set", () => {
    const { container } = renderTable({ isLoading: true, isError: true });
    expect(container.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(0);
    expect(screen.queryByText("Could not load this history")).toBeNull();
  });
});

/**
 * Column widths are opt-in, per table.
 *
 * A declared width makes the table fixed-layout, which is the whole point: a
 * long note on one row stopped squashing the four columns beside it, and they
 * stopped moving when the page changed. A table that declares none must be
 * left exactly as it was — the nutrition, wellness and measurement-log
 * histories all share this component and every one of their columns is a
 * short, bounded figure.
 */
describe("HistoryTable column widths", () => {
  const withWidths: ColumnDef<Row>[] = [
    { key: "day", label: "Day", width: "w-[104px]", render: (v) => <span>{String(v)}</span> },
    { key: "note", label: "Note", render: (v) => <span>{String(v)}</span> },
  ];

  it("goes fixed-layout and carries the width onto its heading", () => {
    const { container } = render(
      <HistoryTable<Row> columns={withWidths} data={[{ day: "Monday" }]} isLoading={false} />
    );

    expect(container.querySelector("table")).toHaveClass("table-fixed");
    const heads = container.querySelectorAll("thead th");
    expect(heads[0]).toHaveClass("w-[104px]");
    // The column that declares none takes what the others leave, so it must
    // carry no width of its own.
    expect(heads[1].className).not.toMatch(/\bw-\[/);
  });

  it("leaves a table that declares no width on the auto layout it has always had", () => {
    const { container } = render(
      <HistoryTable<Row> columns={columns} data={[{ day: "Monday" }]} isLoading={false} />
    );

    expect(container.querySelector("table")).not.toHaveClass("table-fixed");
  });

  it("holds the widths through the loading and empty frames, so nothing jumps when rows land", () => {
    const loading = render(
      <HistoryTable<Row> columns={withWidths} data={[]} isLoading={true} />
    );
    expect(loading.container.querySelector("table")).toHaveClass("table-fixed");
    expect(loading.container.querySelectorAll("thead th")[0]).toHaveClass("w-[104px]");
    loading.unmount();

    const empty = render(
      <HistoryTable<Row> columns={withWidths} data={[]} isLoading={false} />
    );
    expect(empty.container.querySelector("table")).toHaveClass("table-fixed");
    expect(empty.container.querySelectorAll("thead th")[0]).toHaveClass("w-[104px]");
  });
});
