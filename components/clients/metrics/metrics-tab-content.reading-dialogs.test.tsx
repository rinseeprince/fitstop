import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MetricsTabContent } from "./metrics-tab-content";
import type { LogRow, MetricSummary } from "./metrics-view-types";
import type { Client } from "@/types/check-in";

// The reading dialogs' two pieces of state (CONVENTIONS §7 → "No frame
// disagrees"): a close flips `open` and leaves the reading, so the closing
// card still has what it showed; the next open replaces it. jsdom never
// paints a fade, so the host's hand-off is read off stubbed dialogs. Each stub
// carries the id of its MOUNT: the host keys a card by the opening, so every
// open mounts it fresh (its field and its pending flag start over) and a close
// keeps the mount it had.
const mounts = vi.hoisted(() => ({ next: 0 }));
vi.mock("./edit-reading-dialog", async () => {
  const { useState } = await import("react");
  return {
    EditReadingDialog: (props: {
      open: boolean;
      row: LogRow | null;
      onOpenChange: (open: boolean) => void;
    }) => {
      const [mount] = useState(() => ++mounts.next);
      return (
        <div
          data-testid="edit-dialog"
          data-open={String(props.open)}
          data-row={props.row?.id ?? ""}
          data-mount={mount}
        >
          <button onClick={() => props.onOpenChange(false)}>Close edit</button>
        </div>
      );
    },
  };
});
vi.mock("./remove-reading-dialog", async () => {
  const { useState } = await import("react");
  return {
    RemoveReadingDialog: (props: {
      open: boolean;
      row: LogRow | null;
      onOpenChange: (open: boolean) => void;
    }) => {
      const [mount] = useState(() => ++mounts.next);
      return (
        <div
          data-testid="remove-dialog"
          data-open={String(props.open)}
          data-row={props.row?.id ?? ""}
          data-mount={mount}
        >
          <button onClick={() => props.onOpenChange(false)}>Close remove</button>
        </div>
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("journey=body"),
}));
// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("./hooks/use-reading-actions", () => ({
  useReadingActions: () => ({ update: vi.fn(), remove: vi.fn(), restore: vi.fn() }),
}));
vi.mock("./hooks/use-client-blocks", () => ({
  useClientBlocks: () => ({ blocks: [], clientToday: null, isLoading: false, isError: false }),
}));
vi.mock("./metric-progression-section", () => ({
  MetricProgressionSection: () => null,
}));
// Read lazily, at render: the factory is hoisted above the fixtures below.
vi.mock("./hooks/use-merged-metrics", () => ({
  useMergedMetrics: () => ({
    metricsByTab: METRICS_BY_TAB,
    logRowsByTab: LOG_ROWS_BY_TAB,
    isLoading: false,
    isError: false,
    logMeasurement: vi.fn(),
  }),
}));

function metric(id: string, name: string): MetricSummary {
  return {
    id,
    name,
    tab: "body",
    unit: "kg",
    points: [],
    latest: null,
    first: null,
    entryCount: 0,
    totalChange: null,
    startsOn: null,
    avgRate: null,
    change30d: null,
    week: null,
    goal: null,
    goalToGo: null,
    best: null,
  };
}

function row(id: string, date: string, value: number): LogRow {
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
  };
}

const METRICS_BY_TAB = { body: [metric("weight", "Weight")], wellness: [] };
const LOG_ROWS_BY_TAB = {
  body: [row("m-2", "2026-08-14", 90), row("m-1", "2026-08-07", 91)],
  wellness: [],
};

const client = { id: "client-1", name: "Sam Kalepa", startDate: "2026-03-01" } as Client;

beforeEach(() => cleanup());

describe("MetricsTabContent — a reading dialog's close leaves its reading", () => {
  it("Edit: the close hands the dialog open=false and the SAME reading; the next Edit brings the new one", async () => {
    const user = userEvent.setup();
    render(<MetricsTabContent client={client} />);
    const dialog = () => screen.getByTestId("edit-dialog");
    expect(dialog()).toHaveAttribute("data-open", "false");

    const [newer, older] = screen.getAllByRole("button", { name: "Edit reading" });
    await user.click(newer);
    expect(dialog()).toHaveAttribute("data-open", "true");
    expect(dialog()).toHaveAttribute("data-row", "m-2");

    await user.click(screen.getByRole("button", { name: "Close edit" }));
    expect(dialog()).toHaveAttribute("data-open", "false");
    expect(dialog()).toHaveAttribute("data-row", "m-2");

    await user.click(older);
    expect(dialog()).toHaveAttribute("data-open", "true");
    expect(dialog()).toHaveAttribute("data-row", "m-1");
  });

  it("each open mounts the card fresh, the same reading included, and a close keeps its mount", async () => {
    const user = userEvent.setup();
    render(<MetricsTabContent client={client} />);
    const edit = () => screen.getByTestId("edit-dialog");
    const remove = () => screen.getByTestId("remove-dialog");
    const [newer] = screen.getAllByRole("button", { name: "Edit reading" });

    await user.click(newer);
    const opened = edit().getAttribute("data-mount");
    await user.click(screen.getByRole("button", { name: "Close edit" }));
    expect(edit()).toHaveAttribute("data-mount", opened);

    await user.click(newer);
    expect(edit()).toHaveAttribute("data-row", "m-2");
    expect(edit().getAttribute("data-mount")).not.toBe(opened);

    const [newerRemove] = screen.getAllByRole("button", { name: "Remove reading" });
    await user.click(newerRemove);
    const removeOpened = remove().getAttribute("data-mount");
    await user.click(screen.getByRole("button", { name: "Close remove" }));
    expect(remove()).toHaveAttribute("data-mount", removeOpened);
    await user.click(newerRemove);
    expect(remove().getAttribute("data-mount")).not.toBe(removeOpened);
  });

  it("Remove: the close hands the dialog open=false and the SAME reading; the next Remove brings the new one", async () => {
    const user = userEvent.setup();
    render(<MetricsTabContent client={client} />);
    const dialog = () => screen.getByTestId("remove-dialog");
    expect(dialog()).toHaveAttribute("data-open", "false");

    const [newer, older] = screen.getAllByRole("button", { name: "Remove reading" });
    await user.click(newer);
    expect(dialog()).toHaveAttribute("data-open", "true");
    expect(dialog()).toHaveAttribute("data-row", "m-2");

    await user.click(screen.getByRole("button", { name: "Close remove" }));
    expect(dialog()).toHaveAttribute("data-open", "false");
    expect(dialog()).toHaveAttribute("data-row", "m-2");

    await user.click(older);
    expect(dialog()).toHaveAttribute("data-open", "true");
    expect(dialog()).toHaveAttribute("data-row", "m-1");
  });
});
