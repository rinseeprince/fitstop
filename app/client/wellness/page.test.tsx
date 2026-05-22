import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import WellnessLogPage from "./page";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";

// jsdom doesn't implement APIs the Radix Slider needs to render/interact.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!(globalThis as { PointerEvent?: unknown }).PointerEvent) {
  (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent =
    MouseEvent as unknown as typeof PointerEvent;
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

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

type WellnessFields = {
  mood: number | null;
  energy: number | null;
  sleep: number | null;
  stress: number | null;
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

/** Build a GET response; values default to null, loggedStatus to never-logged. */
function wellnessData(
  over: Partial<WellnessFields> & {
    editable?: boolean;
    loggedStatus?: "logged" | "never-logged";
  } = {},
) {
  const { editable = true, loggedStatus = "never-logged", ...values } = over;
  return {
    success: true,
    data: {
      mood: null,
      energy: null,
      sleep: null,
      stress: null,
      ...values,
      editable,
      loggedStatus,
    },
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

describe("Wellness log page", () => {
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
      data: wellnessData({ mood: 4, energy: 7, sleep: 6, stress: 3, loggedStatus: "logged" }),
    });
    render(<WellnessLogPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /great/i })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByText("7/10")).toBeInTheDocument();
    expect(screen.getByText("6/10")).toBeInTheDocument();
    expect(screen.getByText("3/10")).toBeInTheDocument();
  });

  it("submits only the touched fields as the PATCH payload, then returns home", async () => {
    setSWR({ data: wellnessData({ mood: null, energy: 6, loggedStatus: "logged" }) });
    const fetchSpy = mockFetchOnce({ status: 201, body: { success: true, data: {} } });

    render(<WellnessLogPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /good/i })); // mood = 3
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/client/daily-logs/${TODAY}/wellness`);
    expect(init?.method).toBe("PATCH");
    // energy was seeded (pre-touched); sleep/stress untouched → dropped from the partial update.
    expect(JSON.parse(init?.body as string)).toEqual({ mood: 3, energy: 6 });

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ title: "Wellness saved" }),
    );
    // Returns home and refreshes the day-summary so the home card updates.
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock.mock.calls[0][0]).toMatch(/^\/client/);
    // The stale detail cache is dropped so re-entering refetches the saved values.
    expect(globalMutateMock).toHaveBeenCalledWith(
      `/api/client/daily-logs/${TODAY}/wellness`,
      undefined,
      { revalidate: false },
    );
    expect(globalMutateMock).toHaveBeenCalledWith(
      `/api/client/day-summary?date=${TODAY}`,
    );
  });

  it("locks a past, already-logged day: inputs disabled, notice shown, no save", () => {
    setSWR({
      data: wellnessData({
        mood: 3,
        energy: 5,
        sleep: 5,
        stress: 5,
        loggedStatus: "logged",
      }),
    });
    mockSearchParam = PAST;
    const { container } = render(<WellnessLogPage />);

    expect(screen.getByText(/locked and can.t be edited/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /good/i })).toBeDisabled();
    const sliders = container.querySelectorAll('[data-slot="slider"]');
    expect(sliders.length).toBe(3);
    sliders.forEach((slider) => expect(slider).toHaveAttribute("data-disabled"));
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("shows a destructive toast and stays put when the save is rejected", async () => {
    setSWR({ data: wellnessData({ loggedStatus: "never-logged" }) });
    mockFetchOnce({ ok: false, status: 500, body: { success: false, error: "DB blew up" } });

    render(<WellnessLogPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /good/i })); // enable Save
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't save wellness",
          description: "DB blew up",
          variant: "destructive",
        }),
      ),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders a loading skeleton while SWR is loading", () => {
    setSWR({ isLoading: true });
    const { container } = render(<WellnessLogPage />);
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("shows an error state with a Try again button that refetches", async () => {
    setSWR({ error: new Error("boom") });
    render(<WellnessLogPage />);

    expect(screen.getByText(/couldn.t load your wellness/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
  });
});
