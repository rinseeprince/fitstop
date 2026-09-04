import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NutritionLogPage from "./page";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";

const pushMock = vi.fn();
const toastMock = vi.fn();
const mutateMock = vi.fn();
const globalMutateMock = vi.fn();
const swrCall = vi.fn();
let mockSearchParam: string | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({
    get: (key: string) => (key === "date" ? mockSearchParam : null),
  }),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, _fetcher: unknown, _opts: unknown) => swrCall(key),
  // Lazy wrapper: a direct reference would run at hoist time, before the const exists.
  mutate: (...args: unknown[]) => globalMutateMock(...args),
}));

// canEditDay reads the client timezone from here; pin it to UTC so "today" is deterministic.
// The day-rule boundary the page locks on. Read at render time, so a test can
// set it per case. null = no lower bound (a client with no check-in schedule).
let mockLogsOpenFrom: string | null = null;
vi.mock("@/hooks/use-client-profile", () => ({
  useClientProfile: () => ({
    client: { timezone: "UTC", logsOpenFrom: mockLogsOpenFrom },
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

type NutrientValues = {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

function setSWR({
  isLoading = false,
  error,
  data,
}: {
  isLoading?: boolean;
  error?: unknown;
  data?: unknown;
} = {}) {
  swrCall.mockImplementation(() => ({
    data: data ?? undefined,
    error,
    isLoading,
    mutate: mutateMock,
  }));
}

/** Build a GET response with sensible target/consumed defaults. */
function nutritionData(over: {
  consumed?: Partial<NutrientValues> | null;
  target?: Partial<NutrientValues> | null;
  source?: "log" | "event" | null;
} = {}) {
  const target =
    over.target === null
      ? null
      : { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60, ...over.target };
  const consumed =
    over.consumed === null || over.consumed === undefined
      ? null
      : { calories: null, proteinG: null, carbsG: null, fatG: null, ...over.consumed };
  return {
    success: true,
    data: { consumed, target, source: over.source ?? "event", editable: true },
  };
}

function mockFetchOnce(response: { ok?: boolean; status?: number; body?: unknown }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  } as Response);
}

const TODAY = getTodayDateStringInTimezone("UTC");
const PAST = "2020-01-01";

describe("Nutrition log page", () => {
  beforeEach(() => {
    pushMock.mockReset();
    toastMock.mockReset();
    mutateMock.mockReset();
    globalMutateMock.mockReset();
    swrCall.mockReset();
    mockSearchParam = TODAY;
    setSWR();
    cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefills the inputs from the existing log", async () => {
    setSWR({
      data: nutritionData({
        consumed: { calories: 1800, proteinG: 140, carbsG: 180, fatG: 55 },
        source: "log",
      }),
    });
    render(<NutritionLogPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/calories/i)).toHaveValue(1800),
    );
    expect(screen.getByLabelText(/protein/i)).toHaveValue(140);
    expect(screen.getByLabelText(/carbs/i)).toHaveValue(180);
    expect(screen.getByLabelText(/fat/i)).toHaveValue(55);
  });

  it("submits the entered values as the correct PATCH payload", async () => {
    setSWR({ data: nutritionData({ consumed: null, source: "event" }) });
    const fetchSpy = mockFetchOnce({ status: 201, body: { success: true, data: {} } });

    render(<NutritionLogPage />);

    fireEvent.change(screen.getByLabelText(/calories/i), { target: { value: "2100" } });
    fireEvent.change(screen.getByLabelText(/protein/i), { target: { value: "160" } });
    fireEvent.change(screen.getByLabelText(/carbs/i), { target: { value: "210" } });
    fireEvent.change(screen.getByLabelText(/fat/i), { target: { value: "70" } });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/client/daily-logs/${TODAY}/nutrition`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({
      caloriesConsumed: 2100, // GET reads consumed.calories; PATCH sends caloriesConsumed
      proteinG: 160,
      carbsG: 210,
      fatG: 70,
    });
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ title: "Nutrition saved" }),
    );
    // Returns to home and refreshes the day-summary so the home card updates.
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock.mock.calls[0][0]).toMatch(/^\/client/);
    // The stale detail cache is dropped so re-entering refetches the saved values.
    expect(globalMutateMock).toHaveBeenCalledWith(
      `/api/client/daily-logs/${TODAY}/nutrition`,
      undefined,
      { revalidate: false },
    );
    expect(globalMutateMock).toHaveBeenCalledWith(
      `/api/client/day-summary?date=${TODAY}`,
    );
  });

  it("locks a day before the boundary: inputs disabled, notice shown, no save", () => {
    setSWR({
      data: nutritionData({
        consumed: { calories: 1900, proteinG: 150, carbsG: 190, fatG: 60 },
        source: "log",
      }),
    });
    mockSearchParam = PAST;
    // A check-in has closed everything up to 2026-01-01. The log's own presence
    // is not why the day is shut — mutation guard: reading `source === "log"`
    // again would keep this passing with the boundary set to null.
    mockLogsOpenFrom = "2026-01-01";
    render(<NutritionLogPage />);

    expect(screen.getByText("This day is locked.")).toBeInTheDocument();
    expect(screen.getByLabelText(/calories/i)).toBeDisabled();
    expect(screen.getByLabelText(/fat/i)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("shows a destructive toast when the save is rejected", async () => {
    setSWR({ data: nutritionData({ consumed: null, source: "event" }) });
    mockFetchOnce({ ok: false, status: 500, body: { success: false, error: "DB blew up" } });

    render(<NutritionLogPage />);
    fireEvent.change(screen.getByLabelText(/calories/i), { target: { value: "2100" } });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't save nutrition",
          description: "DB blew up",
          variant: "destructive",
        }),
      ),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders a loading skeleton while SWR is loading", () => {
    setSWR({ isLoading: true });
    const { container } = render(<NutritionLogPage />);
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("shows an error state with a Try again button that refetches", async () => {
    setSWR({ error: new Error("boom") });
    render(<NutritionLogPage />);

    expect(screen.getByText(/couldn.t load your nutrition/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });

  it("clamps an out-of-range entry to the schema bound and sends an integer", async () => {
    setSWR({ data: nutritionData({ consumed: null, source: "event" }) });
    const fetchSpy = mockFetchOnce({ status: 201, body: { success: true, data: {} } });

    render(<NutritionLogPage />);
    fireEvent.change(screen.getByLabelText(/calories/i), { target: { value: "99999" } });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
      caloriesConsumed: number;
    };
    expect(body.caloriesConsumed).toBe(10000); // clamped to max
    expect(Number.isInteger(body.caloriesConsumed)).toBe(true);
  });
});
