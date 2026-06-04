import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ExerciseProgressionSection } from "./exercise-progression-section";
import type { ResolvedWindow } from "@/lib/metrics/resolve-time-scope";
import type {
  ExerciseListItem,
  ExerciseProgressionPoint,
} from "@/types/training";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

// Recharts needs ResizeObserver in jsdom.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const ALL_TIME: ResolvedWindow = { start: null, end: null };
const BOUNDED: ResolvedWindow = { start: "2026-02-01", end: "2026-04-30" };

function makeListItem(overrides: Partial<ExerciseListItem> = {}): ExerciseListItem {
  return {
    exerciseId: "ex-1",
    name: "Bench Press",
    logCount: 12,
    lastLoggedDate: "2026-05-15",
    ...overrides,
  };
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

function setupSWR(options: {
  list?: ExerciseListItem[];
  progression?: ExerciseProgressionPoint[];
}) {
  mockUseSWR.mockImplementation((url: string | null) => {
    if (url === null) return { data: undefined, isLoading: false, error: null };
    if (url.includes("metric=list"))
      return { data: { success: true, data: options.list ?? [] }, isLoading: false, error: null };
    if (url.includes("metric=progression"))
      return { data: { success: true, data: options.progression ?? [] }, isLoading: false, error: null };
    return { data: undefined, isLoading: false, error: null };
  });
}

function urlsMatching(fragment: string): string[] {
  return mockUseSWR.mock.calls
    .map((c) => c[0])
    .filter((u): u is string => typeof u === "string" && u.includes(fragment));
}

describe("ExerciseProgressionSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("renders one small-multiple per top exercise, capped at 6", () => {
    // 8 distinct exercises; only the 6 most-logged should render as tiles.
    const list = Array.from({ length: 8 }, (_, i) =>
      makeListItem({ exerciseId: `ex-${i}`, name: `Exercise ${i}` })
    );
    setupSWR({ list, progression: [makePoint()] }); // <2 points → per-chart empty copy
    render(<ExerciseProgressionSection clientId="client-1" window={ALL_TIME} />);

    for (let i = 0; i < 6; i++) {
      expect(screen.getByText(`Exercise ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText("Exercise 6")).not.toBeInTheDocument();
    expect(screen.queryByText("Exercise 7")).not.toBeInTheDocument();
  });

  it("shows the section-level empty state when the windowed list returns zero", () => {
    setupSWR({ list: [] });
    render(<ExerciseProgressionSection clientId="client-1" window={BOUNDED} />);

    expect(screen.getByText("No exercises logged in this window.")).toBeInTheDocument();
    // No exercises → no per-exercise progression fetch.
    expect(urlsMatching("metric=progression")).toHaveLength(0);
  });

  it("renders the per-chart empty state when an exercise has <2 points", () => {
    setupSWR({ list: [makeListItem()], progression: [makePoint()] });
    render(<ExerciseProgressionSection clientId="client-1" window={ALL_TIME} />);
    expect(screen.getByText(/Not enough data yet/i)).toBeInTheDocument();
  });

  it("switches the rendered chart when the metric toggle changes", async () => {
    const user = userEvent.setup();
    setupSWR({
      list: [makeListItem()],
      progression: [makePoint({ date: "2026-05-01" }), makePoint({ date: "2026-05-08" })],
    });
    render(<ExerciseProgressionSection clientId="client-1" window={ALL_TIME} />);

    expect(screen.getByText("Top set weight over time")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Volume" }));
    expect(screen.getByText("Session volume")).toBeInTheDocument();
  });

  it("all-time → requests sessionCount=12 and no date bounds", () => {
    setupSWR({ list: [makeListItem()], progression: [makePoint(), makePoint({ date: "2026-05-08" })] });
    render(<ExerciseProgressionSection clientId="client-1" window={ALL_TIME} />);

    const progUrls = urlsMatching("metric=progression");
    expect(progUrls.some((u) => u.includes("sessionCount=12"))).toBe(true);
    expect(progUrls.every((u) => !u.includes("startDate"))).toBe(true);
    expect(urlsMatching("metric=list").every((u) => !u.includes("startDate"))).toBe(true);
  });

  it("bounded window → passes date bounds and omits sessionCount (rescopes the charts)", () => {
    setupSWR({ list: [makeListItem()], progression: [makePoint(), makePoint({ date: "2026-05-08" })] });
    render(<ExerciseProgressionSection clientId="client-1" window={BOUNDED} />);

    const progUrls = urlsMatching("metric=progression");
    expect(progUrls.some((u) => u.includes("startDate=2026-02-01") && u.includes("endDate=2026-04-30"))).toBe(true);
    expect(progUrls.every((u) => !u.includes("sessionCount"))).toBe(true);
    // List is window-scoped too, so the section-level empty state reflects the window.
    expect(urlsMatching("metric=list").some((u) => u.includes("startDate=2026-02-01"))).toBe(true);
  });
});
