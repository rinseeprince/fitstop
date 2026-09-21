import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
// cmdk scrolls the highlighted option into view
Element.prototype.scrollIntoView = vi.fn();

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

function makeListItem(overrides: Partial<ExerciseListItem> = {}): ExerciseListItem {
  return { exerciseId: "ex-1", name: "Bench Press", logCount: 12, lastLoggedDate: "2026-05-15", exerciseType: "strength", ...overrides };
}
function makePoint(overrides: Partial<ExerciseProgressionPoint> = {}): ExerciseProgressionPoint {
  return {
    date: "2026-05-01T00:00:00Z",
    sessionLogId: "sl-1",
    eventId: null,
    sets: [],
    totalReps: null,
    totalDurationSeconds: null,
    averagePaceSecondsPerKm: null,
    averageSplitSecondsPer500m: null,
    averageStrokeRate: null,
    averagePower: null,
    topSetWeight: 80,
    topSetReps: 8,
    rpe: 7,
    topSetDistanceMeters: null,
    topSetDurationSeconds: null,
    estimatedOneRepMax: 100,
    totalVolume: 2400,
    bestSetReps: null,
    totalDistanceMeters: null,
    longestHoldSeconds: null,
    maxHeartRateZone: null,
    prescribedSets: 3,
    actualSets: 3,
    prescribedRepsMin: 8,
    prescribedRepsMax: 12,
    ...overrides,
  };
}
function makePR(overrides: Partial<Extract<ExercisePR, { kind: "rep_max" }>> = {}): ExercisePR {
  return { kind: "rep_max", reps: 5, weight: 100, date: "2026-05-15T00:00:00Z", sessionLogId: "sl-1", isRecent: false, ...overrides };
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

/** The Personal Records section: the Sessions table above it reads some of the same numbers. */
function personalRecords() {
  return within(screen.getByRole("heading", { name: "Personal Records" }).parentElement as HTMLElement);
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

  it("a pick writes the address and nothing else; the view follows the address, not the click", async () => {
    const user = userEvent.setup();
    setupSWR({ list: [makeListItem()], progression: [makePoint()] });
    const { rerender } = render(<PerformanceView />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Bench Press/ }));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("?exerciseId=ex-1&exerciseName=Bench+Press", { scroll: false });
    // One owner: nothing is picked until the address says so
    expect(screen.getByText(/Pick an exercise above/i)).toBeInTheDocument();
    expect(progressionUrls()).toEqual([]);

    selectExercise();
    rerender(<PerformanceView />);
    expect(screen.queryByText(/Pick an exercise above/i)).toBeNull();
    expect(screen.getByRole("heading", { name: "Personal Records" })).toBeInTheDocument();
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

    expect(personalRecords().getByText("5 Rep Max")).toBeInTheDocument();
    expect(personalRecords().getByText("100")).toBeInTheDocument();
    // Was "lbs" over a kilogram value: metrics-hub threaded a mapper constant
    // down, so the label never reflected the client's own preference.
    expect(personalRecords().getByText("kg")).toBeInTheDocument();
    expect(personalRecords().getByText("New")).toBeInTheDocument();
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

  it("puts the Sessions table between the chart and Personal Records: the sets, then the type's figures", () => {
    selectExercise();
    setupSWR({
      list: [makeListItem()],
      progression: [makePoint({ date: "2026-05-01T00:00:00Z", sessionLogId: "sl-1" }), makePoint({ date: "2026-05-08T00:00:00Z", sessionLogId: "sl-2" })],
      prs: [makePR()],
    });
    render(<PerformanceView />);

    const chart = screen.getByText("Top set weight over time");
    const sessions = screen.getByRole("region", { name: "Sessions" });
    const records = screen.getByRole("heading", { name: "Personal Records" });
    expect(chart.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sessions.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(sessions).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Date", "Sets", "e1RM (kg)", "Top set (kg)", "Volume (kg)", "RPE",
    ]);
    expect(within(sessions).getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Columns/ })).toBeNull();
    // The headings sort, newest first until one is clicked
    expect(within(sessions).getByRole("columnheader", { name: "Date" })).toHaveAttribute("aria-sort", "descending");
    // The arrows alone: the window above already says how many
    expect(within(sessions).queryByText(/Showing/)).toBeNull();
    expect(within(sessions).getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("opens the client's own workout from a session's row, and leaves a row with no workout still", async () => {
    const user = userEvent.setup();
    selectExercise();
    setupSWR({
      list: [makeListItem()],
      progression: [
        makePoint({ date: "2026-05-01T00:00:00Z", sessionLogId: "sl-1", eventId: null }),
        makePoint({ date: "2026-05-08T00:00:00Z", sessionLogId: "sl-2", eventId: "ev-2" }),
      ],
      prs: [],
    });
    render(<PerformanceView />);
    await user.click(screen.getByText("May 1, 2026"));
    expect(mockPush).not.toHaveBeenCalled();
    await user.click(screen.getByText("May 8, 2026"));
    expect(mockPush).toHaveBeenCalledWith("/client/training?eventId=ev-2");
  });

  it("shows the keep-logging PR empty state when there are no PRs", () => {
    selectExercise();
    setupSWR({ list: [makeListItem()], progression: [makePoint(), makePoint({ date: "2026-05-08" })], prs: [] });
    render(<PerformanceView />);
    expect(screen.getByText(/No personal records yet/i)).toBeInTheDocument();
  });
});

describe("PerformanceView — lenses by type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Running");
  });

  it("offers a run its pace and distance, never the coach's lenses, and its best times as PRs", () => {
    setupSWR({
      list: [makeListItem({ name: "Running", exerciseType: "endurance" })],
      progression: [
        makePoint({ topSetWeight: null, topSetReps: null, estimatedOneRepMax: null, totalVolume: null, averagePaceSecondsPerKm: 314, totalDistanceMeters: 5000 }),
        makePoint({ date: "2026-05-08", topSetWeight: null, topSetReps: null, estimatedOneRepMax: null, totalVolume: null, averagePaceSecondsPerKm: 301, totalDistanceMeters: 5000 }),
      ],
      prs: [{ kind: "best_time", distanceMeters: 5000, durationSeconds: 1505, race: "5k", date: "2026-05-08T00:00:00Z", sessionLogId: "sl-1", isRecent: true }],
    });
    render(<PerformanceView />);

    // A lens is a pressed-or-not button; the Sessions table's sorting headings share its words
    expect(screen.getByRole("button", { name: "Pace", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Distance", pressed: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compliance" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Weight" })).toBeNull();
    expect(screen.getByText("Pace over time")).toBeInTheDocument();
    expect(personalRecords().getByText("5 km")).toBeInTheDocument();
    expect(personalRecords().getByText("25:05")).toBeInTheDocument();
  });

  it("shows no metric switcher when an exercise offers one lens", () => {
    setupSWR({
      list: [makeListItem({ name: "Plank", exerciseType: "holds" })],
      progression: [
        makePoint({ topSetWeight: null, topSetReps: null, estimatedOneRepMax: null, totalVolume: null, longestHoldSeconds: 90 }),
        makePoint({ date: "2026-05-08", topSetWeight: null, topSetReps: null, estimatedOneRepMax: null, totalVolume: null, longestHoldSeconds: 120 }),
      ],
    });
    render(<PerformanceView />);

    expect(screen.queryByRole("group", { name: "Metric" })).toBeNull();
    expect(screen.getByRole("group", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByText("Longest hold over time")).toBeInTheDocument();
  });
});
