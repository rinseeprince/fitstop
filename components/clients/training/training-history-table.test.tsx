import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { TrainingHistoryRow } from "@/types/history";
import { TrainingHistoryTable } from "./training-history-table";

// jsdom never paints and Radix Presence unmounts at once there, so the exit
// frame is not observable. What IS observable is the shape that keeps it
// right: each dialog gets `open` apart from its subject, a close flips `open`
// and leaves the subject, and the next show replaces it (CONVENTIONS §7 →
// "No frame disagrees", rule 5). The dialogs are stubbed to expose exactly
// those props.

const rows: TrainingHistoryRow[] = [
  {
    date: "2026-04-06",
    session_name: "Push Day",
    is_alternative: false,
    completion_quality: "full",
    notes: null,
    is_logged: true,
    session_log_id: "sl-a",
  },
  {
    date: "2026-04-07",
    session_name: "Pull Day",
    is_alternative: false,
    completion_quality: "partial",
    notes: null,
    is_logged: true,
    session_log_id: "sl-b",
  },
];

vi.mock("@/hooks/use-history-data", () => ({
  HISTORY_PAGE_SIZE: 10,
  useHistoryData: () => ({
    rows,
    total: rows.length,
    isLoading: false,
    isError: undefined,
    mutate: vi.fn(),
  }),
}));

vi.mock("@/components/clients/training/training-summary-hero", () => ({
  TrainingSummaryHero: () => null,
}));

vi.mock("@/components/programs/shared/divider-pager", () => ({
  DividerPager: () => null,
}));

vi.mock("@/components/clients/history-table/history-table", () => ({
  HistoryTable: ({
    data,
    onColumnClick,
    onRowClick,
  }: {
    data: TrainingHistoryRow[];
    onColumnClick: (key: string) => void;
    onRowClick: (row: TrainingHistoryRow) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onColumnClick("completion_quality")}>
        Status chart
      </button>
      {data.map((row) => (
        <button type="button" key={row.date} onClick={() => onRowClick(row)}>
          {row.session_name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/clients/history-table/history-chart-dialog", () => ({
  HistoryChartDialog: ({
    open,
    onClose,
    data,
  }: {
    open: boolean;
    onClose: () => void;
    data: unknown[];
  }): ReactNode => (
    <div data-testid="chart-dialog" data-open={String(open)} data-points={data.length}>
      <button type="button" onClick={onClose}>
        Close chart
      </button>
    </div>
  ),
}));

vi.mock("@/components/clients/training/session-log-detail-dialog", () => ({
  SessionLogDetailDialog: ({
    open,
    sessionLogId,
    onOpenChange,
    onExerciseDrillDown,
  }: {
    open: boolean;
    sessionLogId: string | null;
    onOpenChange: (open: boolean) => void;
    onExerciseDrillDown?: (exerciseId: string | null, exerciseName: string) => void;
  }): ReactNode => (
    <div
      data-testid="session-dialog"
      data-open={String(open)}
      data-subject={sessionLogId ?? ""}
    >
      <button type="button" onClick={() => onOpenChange(false)}>
        Close session
      </button>
      <button type="button" onClick={() => onExerciseDrillDown?.("ex-1", "Bench Press")}>
        Drill down
      </button>
    </div>
  ),
}));

const sessionDialog = () => screen.getByTestId("session-dialog");
const chartDialog = () => screen.getByTestId("chart-dialog");

describe("TrainingHistoryTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("the session log dialog", () => {
    it("keeps its session log through the close, and the next open replaces it", () => {
      render(<TrainingHistoryTable clientId="client-1" onTabChange={vi.fn()} />);

      fireEvent.click(screen.getByText("Push Day"));
      expect(sessionDialog()).toHaveAttribute("data-open", "true");
      expect(sessionDialog()).toHaveAttribute("data-subject", "sl-a");

      fireEvent.click(screen.getByText("Close session"));
      expect(sessionDialog()).toHaveAttribute("data-open", "false");
      expect(sessionDialog()).toHaveAttribute("data-subject", "sl-a");

      fireEvent.click(screen.getByText("Pull Day"));
      expect(sessionDialog()).toHaveAttribute("data-open", "true");
      expect(sessionDialog()).toHaveAttribute("data-subject", "sl-b");
    });

    it("drills down with one router call and no close beside it", () => {
      const onTabChange = vi.fn();
      render(<TrainingHistoryTable clientId="client-1" onTabChange={onTabChange} />);

      fireEvent.click(screen.getByText("Push Day"));
      fireEvent.click(screen.getByText("Drill down"));

      expect(onTabChange).toHaveBeenCalledTimes(1);
      expect(onTabChange).toHaveBeenCalledWith("metrics", {
        journey: "training",
        exerciseId: "ex-1",
        exerciseName: "Bench Press",
      });
      // The tab change unmounts the whole tab; the click changes no local state.
      expect(sessionDialog()).toHaveAttribute("data-open", "true");
      expect(sessionDialog()).toHaveAttribute("data-subject", "sl-a");
    });
  });

  describe("the chart dialog", () => {
    it("keeps its chart through the close", () => {
      render(<TrainingHistoryTable clientId="client-1" onTabChange={vi.fn()} />);

      expect(chartDialog()).toHaveAttribute("data-open", "false");
      expect(chartDialog()).toHaveAttribute("data-points", "0");

      fireEvent.click(screen.getByText("Status chart"));
      expect(chartDialog()).toHaveAttribute("data-open", "true");
      expect(chartDialog()).toHaveAttribute("data-points", String(rows.length));

      fireEvent.click(screen.getByText("Close chart"));
      expect(chartDialog()).toHaveAttribute("data-open", "false");
      expect(chartDialog()).toHaveAttribute("data-points", String(rows.length));
    });
  });
});
