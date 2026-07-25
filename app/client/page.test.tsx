import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ClientHomePage from "./page";
import { getDateDaysFrom, getTodayDateString } from "@/lib/date-helpers";

const replaceMock = vi.fn();
const swrCall = vi.fn();
let mockSearchParam: string | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => ({
    get: (key: string) => (key === "date" ? mockSearchParam : null),
  }),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, _fetcher: unknown, _opts: unknown) => swrCall(key),
}));

// The home's weekly check-in card fetches its own status and is unit-tested
// separately; stub it here so it doesn't add to the shared SWR mock or skeletons.
vi.mock("@/components/client-portal/day/check-in-card-summary", () => ({
  CheckInCardSummary: () => null,
}));

const today = getTodayDateString();
const todayMidnight = new Date(today + "T00:00:00");
const yesterday = getDateDaysFrom(todayMidnight, -1);
const tomorrow = getDateDaysFrom(todayMidnight, 1);

function setSWR({
  isLoading = false,
  error,
  data,
  mutate = vi.fn(),
}: {
  isLoading?: boolean;
  error?: unknown;
  data?: unknown;
  mutate?: () => unknown;
} = {}) {
  swrCall.mockImplementation(() => ({
    data: data ?? undefined,
    error,
    isLoading,
    mutate,
  }));
}

describe("ClientHomePage", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    swrCall.mockReset();
    mockSearchParam = null;
    setSWR();
    cleanup();
  });

  it("renders the four placeholder labels", () => {
    render(<ClientHomePage />);
    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.getByText("Nutrition")).toBeInTheDocument();
    expect(screen.getByText("Wellness")).toBeInTheDocument();
    expect(screen.getByText("Habits")).toBeInTheDocument();
  });

  it("uses today's date as the SWR key when ?date= is absent", () => {
    mockSearchParam = null;
    render(<ClientHomePage />);
    expect(swrCall).toHaveBeenCalledWith(
      `/api/client/day-summary?date=${today}`,
    );
  });

  it("uses the URL-provided date when it is a valid YYYY-MM-DD", () => {
    mockSearchParam = "2027-05-10";
    render(<ClientHomePage />);
    expect(swrCall).toHaveBeenCalledWith(
      "/api/client/day-summary?date=2027-05-10",
    );
  });

  it("falls back to today when ?date= has the wrong shape", () => {
    mockSearchParam = "garbage";
    render(<ClientHomePage />);
    expect(swrCall).toHaveBeenCalledWith(
      `/api/client/day-summary?date=${today}`,
    );
  });

  it("falls back to today when ?date= passes shape but is semantically invalid (month=13)", () => {
    mockSearchParam = "2026-13-99";
    render(<ClientHomePage />);
    expect(swrCall).toHaveBeenCalledWith(
      `/api/client/day-summary?date=${today}`,
    );
  });

  it("falls back to today when ?date= passes shape but rolls over (Feb 30)", () => {
    mockSearchParam = "2026-02-30";
    render(<ClientHomePage />);
    expect(swrCall).toHaveBeenCalledWith(
      `/api/client/day-summary?date=${today}`,
    );
  });

  it("renders active skeletons while initially loading", () => {
    setSWR({ isLoading: true });
    render(<ClientHomePage />);
    const skeletons = screen.getAllByText(
      "",
      { selector: '[data-slot="skeleton"]' },
    );
    expect(skeletons).toHaveLength(4);
  });

  it("renders summary cards when SWR returns day data", () => {
    setSWR({
      data: {
        success: true,
        data: {
          training: [],
          nutrition: null,
          wellness: { hasLog: false },
          habits: { totalCount: 0, loggedCount: 0 },
        },
      },
    });
    render(<ClientHomePage />);

    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.getByText("Nutrition")).toBeInTheDocument();
    expect(screen.getByText("Wellness")).toBeInTheDocument();
    expect(screen.getByText("Habits")).toBeInTheDocument();
  });

  it("renders an error message with a Try again button when the fetch fails", async () => {
    const mutate = vi.fn();
    setSWR({ error: new Error("boom"), mutate });
    render(<ClientHomePage />);

    expect(screen.getByText(/couldn.t load your day/i)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /try again/i });

    const user = userEvent.setup();
    await user.click(retry);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("navigates to the previous day when the prev-day button is clicked", async () => {
    mockSearchParam = today;
    const user = userEvent.setup();
    render(<ClientHomePage />);

    await user.click(screen.getByRole("button", { name: /previous day/i }));
    expect(replaceMock).toHaveBeenCalledWith(`/client?date=${yesterday}`, {
      scroll: false,
    });
  });

  it("navigates to the next day when the next-day button is clicked", async () => {
    mockSearchParam = today;
    const user = userEvent.setup();
    render(<ClientHomePage />);

    await user.click(screen.getByRole("button", { name: /next day/i }));
    expect(replaceMock).toHaveBeenCalledWith(`/client?date=${tomorrow}`, {
      scroll: false,
    });
  });

  it('replaces to bare /client (no querystring) when "Jump to today" is clicked', async () => {
    mockSearchParam = yesterday;
    const user = userEvent.setup();
    render(<ClientHomePage />);

    await user.click(screen.getByRole("button", { name: /jump to today/i }));
    expect(replaceMock).toHaveBeenCalledWith("/client", { scroll: false });
  });

  it("navigates back one day on ArrowLeft keydown", async () => {
    mockSearchParam = today;
    const user = userEvent.setup();
    render(<ClientHomePage />);

    await user.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(`/client?date=${yesterday}`, {
        scroll: false,
      }),
    );
  });

  it("navigates forward one day on ArrowRight keydown", async () => {
    mockSearchParam = today;
    const user = userEvent.setup();
    render(<ClientHomePage />);

    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(`/client?date=${tomorrow}`, {
        scroll: false,
      }),
    );
  });

  it("ignores arrow keys when focus is in a text input", async () => {
    mockSearchParam = today;
    const user = userEvent.setup();
    render(
      <>
        <ClientHomePage />
        <input data-testid="sibling-input" />
      </>,
    );

    await user.click(screen.getByTestId("sibling-input"));
    await user.keyboard("{ArrowLeft}");
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
