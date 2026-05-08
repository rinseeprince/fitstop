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
    // Reset search params
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

    // The combobox trigger should be present
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders metric segmented control after exercise is selected", () => {
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

    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("e1RM")).toBeInTheDocument();
    expect(screen.getByText("Volume")).toBeInTheDocument();
    expect(screen.getByText("RPE")).toBeInTheDocument();
    expect(screen.getByText("Compliance")).toBeInTheDocument();
    expect(screen.getByText("PRs")).toBeInTheDocument();
  });

  it("renders session count picker (hidden for PRs)", async () => {
    const user = userEvent.setup();
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");

    setupSWR({
      list: [makeListItem()],
      progression: [
        makePoint({ date: "2026-03-01" }),
        makePoint({ date: "2026-03-08" }),
      ],
      prs: [makePR()],
    });

    render(<ExerciseDataView clientId="client-1" />);

    // Session count picker should be visible for Weight
    expect(screen.getByText("Sessions")).toBeInTheDocument();

    // Click PRs
    await user.click(screen.getByText("PRs"));

    // Session count picker should be hidden
    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
  });

  it("renders date span subtitle from progression data", () => {
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");

    setupSWR({
      list: [makeListItem()],
      progression: [
        makePoint({ date: "2026-03-01T00:00:00Z" }),
        makePoint({ date: "2026-03-15T00:00:00Z" }),
        makePoint({ date: "2026-04-01T00:00:00Z" }),
      ],
    });

    render(<ExerciseDataView clientId="client-1" />);

    expect(screen.getByText("Mar 1 to Apr 1")).toBeInTheDocument();
  });

  it("pre-selects exercise from exerciseId URL param", () => {
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");

    setupSWR({
      list: [makeListItem({ exerciseId: "ex-1", name: "Bench Press" })],
      progression: [],
    });

    render(<ExerciseDataView clientId="client-1" />);

    // The combobox should display the selected exercise name
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    // Metric controls should be visible (meaning exercise is selected)
    expect(screen.getByText("Weight")).toBeInTheDocument();
  });
});
