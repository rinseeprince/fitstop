import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MetricsHub } from "./metrics-hub";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

// The Journey adds no weeks up: a habit's recent weeks together are the
// server's `span`. The kernel's adder is watched, so a card that added the
// weeks itself is caught even where its sum matches the server's.
const { sumWeekFigures } = vi.hoisted(() => ({ sumWeekFigures: vi.fn() }));
vi.mock("@/lib/habits/habit-week", async (importOriginal) => {
  const kernel = await importOriginal<typeof import("@/lib/habits/habit-week")>();
  sumWeekFigures.mockImplementation(kernel.sumWeekFigures);
  return { ...kernel, sumWeekFigures };
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver =
  IntersectionObserverMock as unknown as typeof IntersectionObserver;

// Embla (the carousel) reads window.matchMedia for breakpoint options; jsdom omits it.
globalThis.matchMedia =
  globalThis.matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


const progressData = {
  // Raw history arrays kept for the stat tiles / goals section that read them
  // directly (lastWeight / lastBodyFat).
  weightHistory: [
    { date: "2026-05-01", weight: 80 },
    { date: "2026-05-08", weight: 79 },
  ],
  bodyFatHistory: [],
  bodyMeasurements: {},
  // Render-ready series the API now emits (ISO dates on the wire); the hub's
  // thin hook just reads these. The card formats the ISO date at render.
  bodyMetrics: [
    {
      id: "weight",
      name: "Weight",
      currentValue: 79,
      unit: "lbs",
      percentChange: -1.25,
      trend: "down",
      chartData: [
        { date: "2026-05-01", value: 80 },
        { date: "2026-05-08", value: 79 },
      ],
    },
  ],
  wellnessMetrics: [
    {
      id: "mood",
      name: "Mood",
      currentValue: 4,
      unit: "/5",
      percentChange: null,
      trend: "stable",
      chartData: [{ date: "2026-05-01", value: 4 }],
    },
  ],
  client: { weightUnit: "lbs" },
  currentStreak: 3,
  adherenceRate: 90,
  checkInCount: 12,
};

// The Journey's habits, as `GET /api/client/habits/progress?weeks=8` gives
// them: each habit's eight client weeks (Thursday to Wednesday), oldest first,
// the last holding today; those weeks together; and its last days as they
// happened.
const day = (date: string, met: boolean) => ({
  date,
  covered: true,
  planned: true,
  target: null,
  edited: false,
  versionId: "v1",
  timesPerWeek: null,
  entry: met ? { done: true, value: null, note: null } : null,
  met,
});
const habitProgress = {
  clientToday: "2026-09-30",
  habits: [
    {
      habit: { id: "h1", name: "Drink water", howTo: null, measure: "tick", unit: null, direction: null },
      words: { schedule: "Mon, Wed, Fri", target: null },
      weeks: [
        { start: "2026-08-06", end: "2026-08-12", planned: 3, done: 3, met: 3 },
        { start: "2026-08-13", end: "2026-08-19", planned: 3, done: 2, met: 2 },
        { start: "2026-08-20", end: "2026-08-26", planned: 3, done: 3, met: 3 },
        { start: "2026-08-27", end: "2026-09-02", planned: 3, done: 1, met: 1 },
        { start: "2026-09-03", end: "2026-09-09", planned: 3, done: 3, met: 3 },
        { start: "2026-09-10", end: "2026-09-16", planned: 3, done: 2, met: 2 },
        { start: "2026-09-17", end: "2026-09-23", planned: 3, done: 3, met: 3 },
        { start: "2026-09-24", end: "2026-09-30", planned: 3, done: 2, met: 2 },
      ],
      span: { planned: 24, done: 19, met: 19 },
      days: [day("2026-09-28", true), day("2026-09-30", false)],
    },
  ],
};

function setupSWR() {
  mockUseSWR.mockImplementation((url: string | null) => {
    if (typeof url !== "string") return { data: undefined, isLoading: false };
    if (url.includes("/api/client/progress")) return { data: { success: true, data: progressData }, isLoading: false };
    if (url === "/api/client/habits/progress?weeks=8") return { data: { success: true, data: habitProgress }, isLoading: false };
    if (url.includes("metric=list")) return { data: { success: true, data: [] }, isLoading: false };
    return { data: undefined, isLoading: false };
  });
}

describe("MetricsHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    setupSWR();
  });

  it("is headed Journey, as the coach's page is (commit 9b)", () => {
    render(<MetricsHub />);
    expect(screen.getByRole("heading", { level: 1, name: "Journey" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Metrics" })).toBeNull();
  });

  it("renders the four category tabs", () => {
    render(<MetricsHub />);
    expect(screen.getByRole("tab", { name: "Physique" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Performance" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Wellness" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Habits" })).toBeInTheDocument();
  });

  it("defaults to the Physique tab and switches the active tab on click", async () => {
    const user = userEvent.setup();
    render(<MetricsHub />);

    expect(screen.getByRole("tab", { name: "Physique" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "Wellness" }));

    expect(screen.getByRole("tab", { name: "Wellness" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Physique" })).toHaveAttribute("aria-selected", "false");
  });

  it("honors a deep-linked initial tab", () => {
    render(<MetricsHub initialTab="habits" />);
    expect(screen.getByRole("tab", { name: "Habits" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders physique + wellness metric cards and the habit (all slides mounted)", () => {
    render(<MetricsHub />);
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.getByText("Mood")).toBeInTheDocument();
    expect(screen.getByText("Drink water")).toBeInTheDocument();
  });

  it("shows each habit's days, this week's figure and its recent weeks', and no habit streak", () => {
    render(<MetricsHub initialTab="habits" />);
    const card = screen.getByText("Drink water").closest("[data-slot='card']") as HTMLElement;

    expect(within(card).getByText("Mon, Wed, Fri")).toBeInTheDocument();
    expect(within(card).getByText("This week")).toBeInTheDocument();
    expect(within(card).getByText("2 of 3")).toBeInTheDocument();
    // The eight weeks together, as the server sent them: 19 met of 24 planned.
    expect(within(card).getByText("Last 8 weeks")).toBeInTheDocument();
    expect(within(card).getByText("19 of 24")).toBeInTheDocument();
    expect(sumWeekFigures).not.toHaveBeenCalled();
    expect(within(card).queryByText(/streak/i)).toBeNull();
  });

  it("shows no habit section when the client has no habit in the span", () => {
    mockUseSWR.mockImplementation((url: string | null) =>
      url === "/api/client/habits/progress?weeks=8"
        ? { data: { success: true, data: { ...habitProgress, habits: [] } }, isLoading: false }
        : { data: undefined, isLoading: false }
    );
    render(<MetricsHub initialTab="habits" />);
    expect(screen.queryByRole("heading", { name: "My Habits" })).toBeNull();
  });
});
