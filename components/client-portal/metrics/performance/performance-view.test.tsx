import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PerformanceView } from "./performance-view";
import type {
  ExerciseListItem,
  ExerciseProgressionPoint,
  ExercisePR,
} from "@/types/training";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

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

function makeListItem(overrides: Partial<ExerciseListItem> = {}): ExerciseListItem {
  return { exerciseId: "ex-1", name: "Bench Press", logCount: 12, lastLoggedDate: "2026-05-15", ...overrides };
}
function makePoint(overrides: Partial<ExerciseProgressionPoint> = {}): ExerciseProgressionPoint {
  return {
    date: "2026-05-01T00:00:00Z",
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
  return { reps: 5, weight: 100, date: "2026-05-15T00:00:00Z", isRecent: false, ...overrides };
}

function setupSWR(options: {
  list?: ExerciseListItem[];
  progression?: ExerciseProgressionPoint[];
  prs?: ExercisePR[];
}) {
  mockUseSWR.mockImplementation((url: string | null) => {
    if (url === null) return { data: undefined, isLoading: false, error: null };
    if (url.includes("metric=list")) return { data: { success: true, data: options.list ?? [] }, isLoading: false, error: null };
    if (url.includes("metric=progression")) return { data: { success: true, data: options.progression ?? [] }, isLoading: false, error: null };
    if (url.includes("metric=prs")) return { data: { success: true, data: options.prs ?? [] }, isLoading: false, error: null };
    return { data: undefined, isLoading: false, error: null };
  });
}

function progressionUrls(): string[] {
  return mockUseSWR.mock.calls
    .map((c) => c[0])
    .filter((u): u is string => typeof u === "string" && u.includes("metric=progression"));
}

function selectExercise() {
  mockSearchParams.set("exerciseId", "ex-1");
  mockSearchParams.set("exerciseName", "Bench Press");
}

describe("PerformanceView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.delete("exerciseId");
    mockSearchParams.delete("exerciseName");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prompts to pick an exercise when none is selected", () => {
    setupSWR({ list: [makeListItem()] });
    render(<PerformanceView />);
    expect(screen.getByText(/Pick an exercise above/i)).toBeInTheDocument();
  });

  it("renders the weight chart once an exercise is selected", () => {
    selectExercise();
    setupSWR({ list: [makeListItem()], progression: [makePoint({ date: "2026-05-01" }), makePoint({ date: "2026-05-08" })] });
    render(<PerformanceView />);
    expect(screen.getByText("Top set weight over time")).toBeInTheDocument();
  });

  it("switches the chart when the metric toggle changes", async () => {
    const user = userEvent.setup();
    selectExercise();
    setupSWR({ list: [makeListItem()], progression: [makePoint({ date: "2026-05-01" }), makePoint({ date: "2026-05-08" })] });
    render(<PerformanceView />);

    expect(screen.getByText("Top set weight over time")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Volume" }));
    expect(screen.getByText("Session volume")).toBeInTheDocument();
  });

  it("defaults to 12 sessions and refetches when the window changes", async () => {
    const user = userEvent.setup();
    selectExercise();
    setupSWR({ list: [makeListItem()], progression: [makePoint(), makePoint({ date: "2026-05-08" })] });
    render(<PerformanceView />);

    expect(progressionUrls().some((u) => u.includes("sessionCount=12"))).toBe(true);

    await user.click(screen.getByRole("button", { name: "24" }));
    expect(progressionUrls().some((u) => u.includes("sessionCount=24"))).toBe(true);

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(progressionUrls().some((u) => u.includes("sessionCount=500"))).toBe(true);
  });

  it("renders PR cards with the supplied unit and a New badge when recent", () => {
    selectExercise();
    setupSWR({
      list: [makeListItem()],
      progression: [makePoint(), makePoint({ date: "2026-05-08" })],
      prs: [makePR({ reps: 5, weight: 100, isRecent: true })],
    });
    render(<PerformanceView />);

    expect(screen.getByText("5 Rep Max")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    // Was "lbs" over a kilogram value: metrics-hub threaded a mapper constant
    // down, so the label never reflected the client's own preference.
    expect(screen.getByText("kg")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("omits the New badge when the PR is not recent", () => {
    selectExercise();
    setupSWR({
      list: [makeListItem()],
      progression: [makePoint(), makePoint({ date: "2026-05-08" })],
      prs: [makePR({ isRecent: false })],
    });
    render(<PerformanceView />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("renders the consistency stat counting sessions within the last 12 weeks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T12:00:00Z"));
    selectExercise();
    setupSWR({
      list: [makeListItem()],
      // two within 84 days, one well outside
      progression: [
        makePoint({ date: "2026-01-01T00:00:00Z" }),
        makePoint({ date: "2026-05-01T00:00:00Z" }),
        makePoint({ date: "2026-05-15T00:00:00Z" }),
      ],
    });
    render(<PerformanceView />);

    expect(screen.getByText(/in the last 12 weeks/i)).toHaveTextContent(
      "You've logged Bench Press 2 times in the last 12 weeks.",
    );
  });

  it("shows the chart encouragement empty state when there is no progression data", () => {
    selectExercise();
    setupSWR({ list: [makeListItem()], progression: [] });
    render(<PerformanceView />);
    expect(screen.getByText(/Not enough data yet/i)).toBeInTheDocument();
  });

  it("shows the keep-logging PR empty state when there are no PRs", () => {
    selectExercise();
    setupSWR({ list: [makeListItem()], progression: [makePoint(), makePoint({ date: "2026-05-08" })], prs: [] });
    render(<PerformanceView />);
    expect(screen.getByText(/No personal records yet/i)).toBeInTheDocument();
  });
});
