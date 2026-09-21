import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseDataView } from "./exercise-data-view";
import { EXERCISE_HISTORY_MAX_SESSIONS } from "@/lib/training-constants";
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
// cmdk scrolls the highlighted option into view
Element.prototype.scrollIntoView = vi.fn();

const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
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
    exerciseType: "strength",
    ...overrides,
  };
}

function makePoint(overrides: Partial<ExerciseProgressionPoint> = {}): ExerciseProgressionPoint {
  return {
    date: "2026-03-01T00:00:00Z",
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
  return {
    kind: "rep_max",
    reps: 5,
    weight: 100,
    date: "2026-03-15T00:00:00Z",
    sessionLogId: "sl-1",
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
  mutate?: () => Promise<unknown>;
};

const mockRetry = vi.fn();

function setupSWR(options: {
  list?: ExerciseListItem[];
  progression?: ExerciseProgressionPoint[];
  prs?: ExercisePR[];
  listLoading?: boolean;
  progressionFailed?: boolean;
  /** Failed, and SWR's retry is in flight. */
  progressionRetrying?: boolean;
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
      if (options.progressionRetrying) {
        return { data: undefined, isLoading: true, error: new Error("boom"), mutate: mockRetry };
      }
      if (options.progressionFailed) {
        return { data: undefined, isLoading: false, error: new Error("boom"), mutate: mockRetry };
      }
      return {
        data: { success: true, data: options.progression ?? [] },
        isLoading: false,
        error: null,
        mutate: mockRetry,
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

    // The lens row lives in the hero — every option visible, active pressed.
    // A lens is a pressed-or-not button; the Sessions table's sorting headings
    // (an "RPE" among them) are plain buttons.
    for (const label of ["Weight", "e1RM", "Volume", "RPE", "Compliance", "PRs"]) {
      expect(screen.getByRole("button", { name: label, pressed: label === "Weight" })).toBeInTheDocument();
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

  it("keeps the session window live on the PRs lens, whose rail says the cards are all-time", async () => {
    const user = userEvent.setup();
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");

    setupSWR({
      list: [makeListItem()],
      progression: [makePoint(), makePoint({ date: "2026-03-08" })],
      prs: [makePR()],
    });

    render(<ExerciseDataView clientId="client-1" />);

    expect(screen.getByText("Progression")).toBeInTheDocument();
    expect(screen.queryByText("All-time")).toBeNull();
    // KPI strip renders for a windowed metric with data (exercises the
    // (progressionLoading || kpis.length > 0) wrapper guard)
    expect(screen.getByText("Top Set")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "PRs" }));

    // The window governs the Sessions table, so it stays; the cards are all-time
    for (const label of ["8", "12", "24", "All"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("All-time")).toBeInTheDocument();
    expect(screen.queryByText("Top Set")).not.toBeInTheDocument();
    expect(screen.getByText("Personal records")).toBeInTheDocument();
    expect(screen.queryByText("Progression")).not.toBeInTheDocument();
    // The lens row stays in the hero — it's the way back from PRs
    expect(screen.getByRole("button", { name: "Weight" })).toBeInTheDocument();
  });

  it("a pick writes the address and nothing else; the selection follows the URL, not the click", async () => {
    const user = userEvent.setup();
    setupSWR({ list: [makeListItem({ exerciseId: "ex-1", name: "Bench Press" })] });

    const { rerender } = render(<ExerciseDataView clientId="client-1" />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByText("Bench Press"));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("?exerciseId=ex-1&exerciseName=Bench+Press", {
      scroll: false,
    });
    // One owner: nothing is selected until the address says so.
    expect(
      screen.getByText("Select an exercise to view progression data."),
    ).toBeInTheDocument();

    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");
    rerender(<ExerciseDataView clientId="client-1" />);
    expect(
      screen.queryByText("Select an exercise to view progression data."),
    ).not.toBeInTheDocument();
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

describe("ExerciseDataView — lenses by type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Pull Up");
  });

  it("offers a Bodyweight exercise its own lenses, then PRs", () => {
    setupSWR({
      list: [makeListItem({ name: "Pull Up", exerciseType: "bodyweight" })],
      progression: [
        makePoint({ topSetWeight: null, topSetReps: null, estimatedOneRepMax: null, totalVolume: null, rpe: null, bestSetReps: 10 }),
        makePoint({ date: "2026-03-08", topSetWeight: null, topSetReps: null, estimatedOneRepMax: null, totalVolume: null, rpe: null, bestSetReps: 12 }),
      ],
    });

    render(<ExerciseDataView clientId="client-1" />);

    const lenses = screen.getAllByRole("button", { pressed: false }).concat(screen.getAllByRole("button", { pressed: true }));
    const labels = lenses.map((b) => b.textContent);
    expect(labels).toContain("Best set reps");
    expect(labels).toContain("Compliance");
    expect(labels).toContain("PRs");
    expect(labels).not.toContain("Weight");
    expect(screen.getByRole("button", { name: "Best set reps" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Best set reps over time")).toBeInTheDocument();
  });

  it("follows what was logged: a weighted session offers the lift's lenses after the type's own", () => {
    setupSWR({
      list: [makeListItem({ name: "Pull Up", exerciseType: "bodyweight" })],
      progression: [
        makePoint({ topSetWeight: 10, topSetReps: 5, estimatedOneRepMax: 11.7, totalVolume: 50, rpe: null, bestSetReps: null }),
        makePoint({ date: "2026-03-08", topSetWeight: null, topSetReps: null, estimatedOneRepMax: null, totalVolume: null, rpe: null, bestSetReps: 12 }),
      ],
    });

    render(<ExerciseDataView clientId="client-1" />);

    for (const label of ["Best set reps", "Compliance", "Weight", "e1RM", "Volume", "PRs"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // No RPE lens (the table's RPE heading is a button too, but no lens)
    expect(screen.queryByRole("button", { name: "RPE", pressed: false })).toBeNull();
    expect(screen.queryByRole("button", { name: "RPE", pressed: true })).toBeNull();
  });
});

describe("ExerciseDataView — the Sessions table", () => {
  const bench = (day: string, id: string, weight: number) =>
    makePoint({
      date: `2026-03-${day}T00:00:00Z`,
      sessionLogId: id,
      topSetWeight: weight,
      sets: [{ weight, reps: 8, distanceMeters: null, durationSeconds: null }],
    });
  const benchSessions = [bench("01", "sl-1", 80), bench("08", "sl-2", 90), bench("15", "sl-3", 85)];

  // Each row's sets, as the table reads them
  const rowSets = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1].textContent);

  const progressionUrls = () =>
    mockUseSWR.mock.calls
      .map(([url]) => url as string | null)
      .filter((url): url is string => url != null && url.includes("metric=progression"));

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.set("exerciseId", "ex-1");
    mockSearchParams.set("exerciseName", "Bench Press");
    setupSWR({ list: [makeListItem()], progression: benchSessions, prs: [makePR()] });
  });

  it("sits beneath the chart and beneath the PR cards, reading the one sessions read on every lens", async () => {
    const user = userEvent.setup();
    render(<ExerciseDataView clientId="client-1" />);
    expect(screen.getByRole("region", { name: "Sessions" })).toBeInTheDocument();
    expect(rowSets()).toEqual(["85 × 8", "90 × 8", "80 × 8"]);

    mockUseSWR.mockClear();
    await user.click(screen.getByRole("button", { name: "PRs" }));
    expect(screen.getByText("5 Rep Max")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sessions" })).toBeInTheDocument();
    expect(rowSets()).toEqual(["85 × 8", "90 × 8", "80 × 8"]);
    // The PRs lens still reads the window's sessions — the same key, no new read
    expect(progressionUrls().length).toBeGreaterThan(0);
    expect(new Set(progressionUrls()).size).toBe(1);
  });

  it("stars the session holding a record on every lens, the records read before the PRs lens is picked", () => {
    setupSWR({ list: [makeListItem()], progression: benchSessions, prs: [makePR({ reps: 8, weight: 90, date: "2026-03-08T00:00:00Z", sessionLogId: "sl-2" })] });
    render(<ExerciseDataView clientId="client-1" />);
    const star = screen.getByRole("img", { name: "Personal record: 8 Rep Max · 90 kg" });
    expect(within(screen.getAllByRole("row")[2]).getByRole("img")).toBe(star);
  });

  it("keeps its sort and page through a lens switch", async () => {
    const user = userEvent.setup();
    render(<ExerciseDataView clientId="client-1" />);
    await user.click(screen.getByRole("button", { name: "Top set (kg)" }));

    await user.click(screen.getByRole("button", { name: "PRs" }));
    await user.click(screen.getByRole("button", { name: "e1RM", pressed: false }));

    expect(screen.getByRole("columnheader", { name: "Top set (kg)" })).toHaveAttribute("aria-sort", "descending");
    expect(rowSets()).toEqual(["90 × 8", "85 × 8", "80 × 8"]);
  });

  it("starts fresh when another exercise is picked", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ExerciseDataView clientId="client-1" />);
    await user.click(screen.getByRole("button", { name: "Top set (kg)" }));
    expect(rowSets()).toEqual(["90 × 8", "85 × 8", "80 × 8"]);

    // The address is the subject: the drill-down or the picker writes it
    mockSearchParams.set("exerciseId", "ex-2");
    mockSearchParams.set("exerciseName", "Squat");
    rerender(<ExerciseDataView clientId="client-1" />);

    expect(screen.getByRole("columnheader", { name: "Date" })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: "Top set (kg)" })).toHaveAttribute("aria-sort", "none");
    expect(rowSets()).toEqual(["85 × 8", "90 × 8", "80 × 8"]);
  });

  it("opens a session's workout from its row, in one click", async () => {
    const user = userEvent.setup();
    render(<ExerciseDataView clientId="client-1" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByText("Mar 8, 2026"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The workout log reads the session the row is
    const logUrls = mockUseSWR.mock.calls
      .map(([url]) => url as string | null)
      .filter((url): url is string => url != null && url.includes("sl-2"));
    expect(logUrls.length).toBeGreaterThan(0);
  });

  it("holds its figures until the list says the exercise's type", () => {
    setupSWR({ list: [makeListItem()], listLoading: true, progression: benchSessions, prs: [] });
    render(<ExerciseDataView clientId="client-1" />);
    const sessions = screen.getByRole("region", { name: "Sessions" });
    expect(within(sessions).queryByRole("columnheader", { name: "Date" })).toBeNull();
  });

  it("asks for every session up to the bound when the window is All — never the read's 12-session floor", async () => {
    const user = userEvent.setup();
    render(<ExerciseDataView clientId="client-1" />);
    expect(progressionUrls().at(-1)).toContain("sessionCount=12");
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(progressionUrls().at(-1)).toContain(`sessionCount=${EXERCISE_HISTORY_MAX_SESSIONS}`);
  });

  it("shows the chart and the table loading together while a retry is in flight — never an error beside a skeleton", () => {
    setupSWR({ list: [makeListItem()], progressionRetrying: true });
    const { container } = render(<ExerciseDataView clientId="client-1" />);
    expect(screen.queryByText("Couldn't load the sessions")).toBeNull();
    const sessions = screen.getByRole("region", { name: "Sessions" });
    expect(within(sessions).queryByRole("columnheader", { name: "Date" })).toBeNull();
    expect(container.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(0);
  });

  it("says a failed sessions read failed in the chart and the table alike, each with Try again", async () => {
    const user = userEvent.setup();
    setupSWR({ list: [makeListItem()], progressionFailed: true });
    render(<ExerciseDataView clientId="client-1" />);
    expect(screen.getAllByText("Couldn't load the sessions")).toHaveLength(2);
    expect(screen.queryByText(/Not enough data yet/)).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Try again" })[1]);
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });
});
