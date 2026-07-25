import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseDataView } from "./exercise-data-view";
import type { ExerciseListItem, ExerciseProgressionPoint, ExercisePR } from "@/types/training";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

// Recharts needs ResizeObserver
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeListItem(overrides: Partial<ExerciseListItem> = {}): ExerciseListItem {
  return {
    exerciseId: "ex-1",
    name: "Bench Press",
    logCount: 12,
    lastLoggedDate: "2026-03-15",
    ...overrides,
  };
}

function makePoint(overrides: Partial<ExerciseProgressionPoint> = {}): ExerciseProgressionPoint {
  return {
    date: "2026-03-01T00:00:00Z",
    sessionLogId: "sl-1",
    topSetWeight: 80,
    topSetReps: 8,
    estimatedOneRepMax: 100,
    totalVolume: 2400,
    topSetRpe: 7,
    prescribedSets: 3,
    actualSets: 3,
    prescribedRepsMin: 8,
    prescribedRepsMax: 12,
    ...overrides,
  };
}

function makePR(overrides: Partial<ExercisePR> = {}): ExercisePR {
  return {
    reps: 5,
    weight: 100,
    date: "2026-03-15T00:00:00Z",
    isRecent: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SWRResponse = {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
};

function setupSWR(options: {
  list?: ExerciseListItem[];
  progression?: ExerciseProgressionPoint[];
  prs?: ExercisePR[];
  listLoading?: boolean;
}) {
  mockUseSWR.mockImplementation((url: string | null): SWRResponse => {
    if (url === null) return { data: undefined, isLoading: false, error: null };

    if (url.includes("metric=list")) {
      return {
        data: options.listLoading ? undefined : { success: true, data: options.list ?? [] },
        isLoading: options.listLoading ?? false,
        error: null,
      };
    }
    if (url.includes("metric=progression")) {
      return {
        data: { success: true, data: options.progression ?? [] },
        isLoading: false,
        error: null,
      };
    }
    if (url.includes("metric=prs")) {
      return {
        data: { success: true, data: options.prs ?? [] },
        isLoading: false,
        error: null,
      };
    }
    return { data: undefined, isLoading: false, error: null };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExerciseDataView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.delete("exerciseId");
    mockSearchParams.delete("exerciseName");
  });

  it("renders empty state when no exercise is selected", () => {
    setupSWR({ list: [makeListItem()] });

    render(<ExerciseDataView clientId="client-1" />);

    expect(
      screen.getByText("Select an exercise to view progression data."),
    ).toBeInTheDocument();
  });

  it("renders exercise picker with exercise list", () => {
    setupSWR({ list: [makeListItem({ name: "Bench Press" })] });

    render(<ExerciseDataView clientId="client-1" />);

    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders the hero metric lens row and divider label after exercise is selected", () => {
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");

    setupSWR({
      list: [makeListItem()],
      progression: [
        makePoint({ date: "2026-03-01" }),
        makePoint({ date: "2026-03-08" }),
      ],
    });

    render(<ExerciseDataView clientId="client-1" />);

    // The lens row lives in the hero — every option visible, active pressed
    for (const label of ["Weight", "e1RM", "Volume", "RPE", "Compliance", "PRs"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Weight" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Progression")).toBeInTheDocument();
  });

  it("renders the session-window control on the divider rail", () => {
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");

    setupSWR({
      list: [makeListItem()],
      progression: [makePoint(), makePoint({ date: "2026-03-08" })],
    });

    render(<ExerciseDataView clientId="client-1" />);

    for (const label of ["8", "12", "24", "All"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("hides the session window and KPI strip for the PRs lens", async () => {
    const user = userEvent.setup();
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");

    setupSWR({
      list: [makeListItem()],
      progression: [makePoint(), makePoint({ date: "2026-03-08" })],
      prs: [makePR()],
    });

    render(<ExerciseDataView clientId="client-1" />);

    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Progression")).toBeInTheDocument();
    // KPI strip renders for a windowed metric with data (exercises the
    // (progressionLoading || kpis.length > 0) wrapper guard)
    expect(screen.getByText("Top Set")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "PRs" }));

    expect(screen.queryByText("All")).not.toBeInTheDocument();
    expect(screen.queryByText("Top Set")).not.toBeInTheDocument();
    expect(screen.getByText("Personal records")).toBeInTheDocument();
    expect(screen.queryByText("Progression")).not.toBeInTheDocument();
    // The lens row stays in the hero — it's the way back from PRs
    expect(screen.getByRole("button", { name: "Weight" })).toBeInTheDocument();
  });

  it("pre-selects exercise from exerciseId URL param", () => {
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");

    setupSWR({
      list: [makeListItem({ exerciseId: "ex-1", name: "Bench Press" })],
      progression: [],
    });

    render(<ExerciseDataView clientId="client-1" />);

    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Weight")).toBeInTheDocument();
  });
});
