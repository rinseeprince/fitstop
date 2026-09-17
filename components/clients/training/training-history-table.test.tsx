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

const BASE_ROWS: TrainingHistoryRow[] = [
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

// The rows the mocked read hands over. A case that needs its own week replaces
// this and the top-level beforeEach puts the base week back.
let rows: TrainingHistoryRow[] = [...BASE_ROWS];

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
    columns,
    data,
    onColumnClick,
    onRowClick,
  }: {
    columns: {
      key: string;
      width?: string;
      render: (value: unknown, row: TrainingHistoryRow) => ReactNode;
    }[];
    data: TrainingHistoryRow[];
    onColumnClick: (key: string) => void;
    onRowClick: (row: TrainingHistoryRow) => void;
  }) => {
    // The cells a coach reads, rendered through the real column defs: the
    // Status chip, the Session name beside its Alt chip, and the note.
    const cell = (key: string) => columns.find((column) => column.key === key);
    return (
      <div>
        <button type="button" onClick={() => onColumnClick("completion_quality")}>
          Status chart
        </button>
        {/* Each column's declared width, so the layout contract is assertable
            without a paint — jsdom lays nothing out. */}
        <div
          data-testid="column-widths"
          data-widths={columns.map((column) => `${column.key}:${column.width ?? ""}`).join(" ")}
        />
        {data.map((row) => (
          <div key={row.date}>
            <button type="button" onClick={() => onRowClick(row)}>
              {row.session_name}
            </button>
            {cell("completion_quality")?.render(row.completion_quality, row)}
            <div data-testid={`session-${row.date}`}>
              {cell("session_name")?.render(row.session_name, row)}
            </div>
            <div data-testid={`notes-${row.date}`}>
              {cell("notes")?.render(row.notes, row)}
            </div>
          </div>
        ))}
      </div>
    );
  },
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

beforeEach(() => {
  rows = [...BASE_ROWS];
});

describe("TrainingHistoryTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("the session log dialog", () => {
    it("keeps its session log through the close, and the next open replaces it", () => {
      render(<TrainingHistoryTable clientId="client-1" onTabChange={vi.fn()} />);

      fireEvent.click(screen.getByRole("button", { name: "Push Day" }));
      expect(sessionDialog()).toHaveAttribute("data-open", "true");
      expect(sessionDialog()).toHaveAttribute("data-subject", "sl-a");

      fireEvent.click(screen.getByText("Close session"));
      expect(sessionDialog()).toHaveAttribute("data-open", "false");
      expect(sessionDialog()).toHaveAttribute("data-subject", "sl-a");

      fireEvent.click(screen.getByRole("button", { name: "Pull Day" }));
      expect(sessionDialog()).toHaveAttribute("data-open", "true");
      expect(sessionDialog()).toHaveAttribute("data-subject", "sl-b");
    });

    it("drills down with one router call and no close beside it", () => {
      const onTabChange = vi.fn();
      render(<TrainingHistoryTable clientId="client-1" onTabChange={onTabChange} />);

      fireEvent.click(screen.getByRole("button", { name: "Push Day" }));
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

describe("the Status chip", () => {
  it("reads the quality on the workout's LOG — a partial log is Partial", () => {
    // `completion_quality` reaches the row off the log (mapEventsToScheduleDays),
    // never off the event's status word, so the same chip renders before and
    // after the status word's meaning widens in commit 10.
    render(<TrainingHistoryTable clientId="client-1" onTabChange={vi.fn()} />);

    expect(screen.getByText("Completed")).toBeInTheDocument(); // the full row
    expect(screen.getByText("Partial")).toBeInTheDocument(); // the partial row
  });
});

/**
 * The columns hold their width whatever is in them.
 *
 * A single long note used to set the Notes column's width and the four beside
 * it gave up the space — so the grid moved as the coach paged. The four data
 * columns now declare a measured width and Notes takes what they leave, which
 * means the two columns holding text the coach wrote have to clip instead of
 * spilling into their neighbour.
 */
describe("the columns' widths", () => {
  const widths = () =>
    screen.getByTestId("column-widths").getAttribute("data-widths") ?? "";

  it("declares a width for every column — the four bounded in px, Notes as a share", () => {
    render(<TrainingHistoryTable clientId="client-1" onTabChange={vi.fn()} />);

    // EVERY column declares one: the leftover space is shared in proportion to
    // them, so the five grow together and fill the card. Leaving Notes
    // undeclared handed it the whole remainder and bunched the rest on the
    // left. Notes is a percentage because it is the one that should yield first
    // when the window is narrow.
    expect(widths()).toBe(
      "date:w-[100px] day:w-[120px] session_name:w-[208px] completion_quality:w-[130px] notes:w-[34%]"
    );
  });

  it("clips a long note at the column instead of at a character count", () => {
    const note =
      "Knee felt off — stopped after the squats, and the hamstring curls felt tight the whole way through so I called it there rather than push on.";
    rows = [{ ...BASE_ROWS[0], notes: note }];

    render(<TrainingHistoryTable clientId="client-1" onTabChange={vi.fn()} />);
    const cell = screen.getByTestId("notes-2026-04-06");

    // The whole note is in the DOM and the browser ellipses it at the column's
    // edge; the old 50-character slice truncated with its own "..." and could
    // not know how wide the column was.
    expect(cell).toHaveTextContent(note);
    expect(cell.textContent).not.toContain("...");
    expect(cell.querySelector("span")).toHaveClass("truncate");
  });

  it("still shows a dash when the workout carries no note", () => {
    render(<TrainingHistoryTable clientId="client-1" onTabChange={vi.fn()} />);

    expect(screen.getByTestId("notes-2026-04-06")).toHaveTextContent("—");
  });

  it("clips a long session name and keeps its Alt chip beside it", () => {
    rows = [
      {
        ...BASE_ROWS[0],
        session_name: "Glutes, hamstrings and a very long name a coach typed",
        is_alternative: true,
      },
    ];

    render(<TrainingHistoryTable clientId="client-1" onTabChange={vi.fn()} />);
    const cell = screen.getByTestId("session-2026-04-06");

    // The NAME clips; the chip is `shrink-0`, so a long name can never push it
    // out of the cell.
    expect(cell.querySelector(".truncate")).toHaveTextContent(
      "Glutes, hamstrings and a very long name a coach typed"
    );
    expect(cell).toHaveTextContent("Alt");
  });
});
