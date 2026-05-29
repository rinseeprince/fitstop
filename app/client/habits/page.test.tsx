import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import HabitsLogPage from "./page";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";
import type { DailyHabit } from "@/types/daily-habit";

const toastMock = vi.fn();
const habitsMutate = vi.fn();
const logsMutate = vi.fn();
const globalMutateMock = vi.fn();
const swrCall = vi.fn();
let mockSearchParam: string | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === "date" ? mockSearchParam : null),
  }),
}));

// The page makes TWO useSWR calls (habits + logs); the mock returns per-key data and a
// per-key bound mutate. logsMutate runs the passed mutator so the optimistic POST fires.
vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown) => swrCall(key),
  mutate: (...args: unknown[]) => globalMutateMock(...args),
}));

// canEditDay reads the client timezone from here; pin to UTC so "today" is deterministic.
vi.mock("@/hooks/use-client-profile", () => ({
  useClientProfile: () => ({
    client: { timezone: "UTC" },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const TODAY = getTodayDateStringInTimezone("UTC");
const PAST = "2020-01-01";

function habit(over: Partial<DailyHabit> & { id: string }): DailyHabit {
  return {
    coachId: "coach-1",
    clientId: "client-1",
    name: "Habit",
    isBoolean: true,
    isActive: true,
    sortOrder: 0,
    effectiveDate: "2000-01-01",
    createdAt: "2000-01-01T00:00:00Z",
    updatedAt: "2000-01-01T00:00:00Z",
    ...over,
  };
}

function setSWR({
  habits = [],
  logs = [],
  isLoading = false,
  error,
}: {
  habits?: DailyHabit[];
  logs?: unknown[];
  isLoading?: boolean;
  error?: unknown;
} = {}) {
  swrCall.mockImplementation((key: string) => {
    const isLogs = typeof key === "string" && key.startsWith("/api/client/habits/logs");
    return {
      data: error ? undefined : { success: true, data: isLogs ? logs : habits },
      error,
      isLoading,
      mutate: isLogs ? logsMutate : habitsMutate,
    };
  });
}

function mockFetchOnce(response: { ok?: boolean; status?: number; body?: unknown }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  } as Response);
}

describe("Habits log page", () => {
  beforeEach(() => {
    toastMock.mockReset();
    habitsMutate.mockReset();
    logsMutate.mockReset();
    globalMutateMock.mockReset();
    swrCall.mockReset();
    mockSearchParam = TODAY;
    // The bound logs `mutate` runs the async mutator so the POST fires (and a throw/rollback
    // propagates back to the handler).
    logsMutate.mockImplementation(async (fnOrData?: unknown) => {
      if (typeof fnOrData === "function") {
        return (fnOrData as () => Promise<unknown>)();
      }
    });
    setSWR();
    cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders one switch per active habit and hides not-yet-effective habits", () => {
    setSWR({
      habits: [
        habit({ id: "h1", name: "Water" }),
        habit({ id: "h2", name: "Walk" }),
        habit({ id: "h3", name: "Future habit", effectiveDate: "2999-01-01" }),
      ],
      logs: [],
    });
    render(<HabitsLogPage />);

    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getByText("Water")).toBeInTheDocument();
    expect(screen.queryByText("Future habit")).toBeNull();
  });

  it("fires a POST with the toggle payload when a habit is switched on", async () => {
    setSWR({ habits: [habit({ id: "h1", name: "Water" })], logs: [] });
    const fetchSpy = mockFetchOnce({
      status: 200,
      body: { success: true, data: { id: "log-1", dailyHabitId: "h1", completed: true } },
    });

    render(<HabitsLogPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("switch"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/client/habits/log");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      dailyHabitId: "h1",
      date: TODAY,
      completed: true,
    });
  });

  it("locks only the recorded habit on a past day and still allows backfilling a missed one", async () => {
    setSWR({
      habits: [habit({ id: "h1", name: "Water" }), habit({ id: "h2", name: "Walk" })],
      logs: [
        {
          id: "l1",
          dailyHabitId: "h1",
          clientId: "client-1",
          date: PAST,
          completed: true,
          habitName: "Water",
          isBoolean: true,
        },
      ],
    });
    mockSearchParam = PAST;
    const fetchSpy = mockFetchOnce({
      status: 200,
      body: { success: true, data: { id: "l2", dailyHabitId: "h2", completed: true } },
    });

    render(<HabitsLogPage />);
    const switches = screen.getAllByRole("switch");
    // h1 (already recorded) is locked; h2 (missed) stays editable — habit-grained lock.
    expect(switches[0]).toBeDisabled();
    expect(switches[1]).not.toBeDisabled();
    // Only partially locked → no day-level notice.
    expect(screen.queryByText(/locked and can.t be edited/i)).toBeNull();

    const user = userEvent.setup();
    await user.click(switches[1]);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      dailyHabitId: "h2",
      date: PAST,
      completed: true,
    });
  });

  it("shows the locked notice and disables all toggles when every habit is recorded on a past day", () => {
    setSWR({
      habits: [habit({ id: "h1", name: "Water" }), habit({ id: "h2", name: "Walk" })],
      logs: [
        {
          id: "l1",
          dailyHabitId: "h1",
          clientId: "client-1",
          date: PAST,
          completed: true,
          habitName: "Water",
          isBoolean: true,
        },
        {
          id: "l2",
          dailyHabitId: "h2",
          clientId: "client-1",
          date: PAST,
          completed: false,
          habitName: "Walk",
          isBoolean: true,
        },
      ],
    });
    mockSearchParam = PAST;
    render(<HabitsLogPage />);

    expect(screen.getByText(/locked and can.t be edited/i)).toBeInTheDocument();
    screen.getAllByRole("switch").forEach((s) => expect(s).toBeDisabled());
  });

  it("renders the empty state when there are no habits", () => {
    setSWR({ habits: [], logs: [] });
    render(<HabitsLogPage />);
    expect(screen.getByText(/no daily habits set up yet/i)).toBeInTheDocument();
  });

  it("renders a loading skeleton while SWR is loading", () => {
    setSWR({ isLoading: true });
    const { container } = render(<HabitsLogPage />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("shows an error state with a Try again button that refetches both keys", async () => {
    setSWR({ error: new Error("boom") });
    render(<HabitsLogPage />);
    expect(screen.getByText(/couldn.t load your habits/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(habitsMutate).toHaveBeenCalled();
    expect(logsMutate).toHaveBeenCalled();
  });
});
