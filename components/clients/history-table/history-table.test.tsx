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
