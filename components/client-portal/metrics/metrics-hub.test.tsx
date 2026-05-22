import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MetricsHub } from "./metrics-hub";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

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

const progressData = {
  weightHistory: [
    { date: "2026-05-01", weight: 80 },
    { date: "2026-05-08", weight: 79 },
  ],
  bodyFatHistory: [],
  bodyMeasurements: {},
  wellnessMetrics: {
    moodHistory: [{ date: "2026-05-01", mood: 4 }],
    energyHistory: [],
    sleepHistory: [],
    stressHistory: [],
  },
  client: { weightUnit: "lbs" },
  currentStreak: 3,
  adherenceRate: 90,
  checkInCount: 12,
};

const habits = [
  { id: "h1", name: "Drink water", isBoolean: true, isActive: true, sortOrder: 0 },
];

function setupSWR() {
  mockUseSWR.mockImplementation((url: string | null) => {
    if (typeof url !== "string") return { data: undefined, isLoading: false };
    if (url.includes("/api/client/progress")) return { data: { success: true, data: progressData }, isLoading: false };
    if (url.includes("/api/client/habits/logs")) return { data: { data: [] }, isLoading: false };
    if (url.includes("/api/client/habits")) return { data: { data: habits }, isLoading: false };
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
});
