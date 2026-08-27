import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const { mockUseSWR, mockToast, mockMutate } = vi.hoisted(() => ({
  mockUseSWR: vi.fn(),
  mockToast: vi.fn(),
  mockMutate: vi.fn(),
}));
vi.mock("swr", () => ({
  default: mockUseSWR,
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

import { TrainingWeekLayout } from "./training-week-layout";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";

// Mon 24 → Sun 30 Aug 2026, today Wed 26.
const MON = "2026-08-24";
const WED = "2026-08-26";
const THU = "2026-08-27";
const SAT = "2026-08-29";
const SUN = "2026-08-30";
const STACK = "Two sessions on one day — move one";
const DRIFT = "Your week changed since you opened it — reload and try again";

function weekResponse(sessions: ClientTrainingWeekSession[]) {
  return {
    data: { success: true, data: { weekStart: MON, weekEnd: SUN, today: WED, sessions } },
    isLoading: false,
    error: undefined,
    mutate: mockMutate,
  };
}

const session = (over: Partial<ClientTrainingWeekSession>): ClientTrainingWeekSession => ({
  eventId: "ev",
  sessionId: "s",
  name: "Session",
  focus: null,
  date: THU,
  state: "upcoming",
  isScheduled: true,
  ...over,
});
const pushDone = session({ eventId: "ev-mon", name: "Push", date: MON, state: "done", isScheduled: false });
const legs = session({ eventId: "ev-thu", name: "Legs", focus: "Lower", date: THU });
const upper = session({ eventId: "ev-sat", name: "Upper", date: SAT });

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const chip = (name: string) => screen.getByText(name).closest("button");
const dayTarget = (name: string, day: string) => screen.getByRole("button", { name: `Move ${name} to ${day}` });
const saveButton = () => screen.getByRole("button", { name: "Save" });

describe("TrainingWeekLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSWR.mockReturnValue(weekResponse([pushDone, legs, upper]));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reads the week containing today and lays each session on its day, rest days empty", () => {
    render(<TrainingWeekLayout />);

    expect(mockUseSWR).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/client\/training\/week\?date=\d{4}-\d{2}-\d{2}$/),
      expect.anything(),
      expect.anything(),
    );
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getByText("Legs")).toBeInTheDocument();
    expect(screen.getByText("Upper")).toBeInTheDocument();
    expect(screen.getAllByText("Rest")).toHaveLength(4);
    expect(screen.getByText("Today")).toBeInTheDocument();
    // A logged session is pinned — not something to pick up.
    expect(chip("Push")).toBeNull();
    expect(chip("Legs")).not.toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it("swaps two days by stacking then un-stacking, and saves the whole layout in one POST", async () => {
    const fetchMock = stubFetch(200, { success: true, data: { moved: [] } });
    render(<TrainingWeekLayout />);

    // Pick Legs up: every day becomes the drop target.
    fireEvent.click(chip("Legs")!);
    expect(screen.getByText("Tap a day to move Legs there.")).toBeInTheDocument();
    fireEvent.click(dayTarget("Legs", "Sat, Aug 29"));

    // Legs now sits with Upper: a stack, shown inline, Save blocked.
    expect(screen.getByText(/moved from Thu/)).toBeInTheDocument();
    expect(screen.getByText(STACK)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    // Move Upper onto Legs' old day: the stack resolves.
    fireEvent.click(chip("Upper")!);
    fireEvent.click(dayTarget("Upper", "Thu, Aug 27"));
    expect(screen.queryByText(STACK)).toBeNull();
    expect(saveButton()).toBeEnabled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: "Week updated" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/client/training/events/layout");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      moves: [
        { eventId: "ev-thu", fromDate: THU, toDate: SAT },
        { eventId: "ev-sat", fromDate: SAT, toDate: THU },
      ],
    });
    // Pending state is gone once saved; the refetch settles the chips.
    expect(screen.queryByText(/moved from/)).toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it("shows a 409 in the server's words with a Reload that refetches and clears the pending moves", async () => {
    stubFetch(409, { success: false, error: DRIFT });
    render(<TrainingWeekLayout />);

    fireEvent.click(chip("Legs")!);
    fireEvent.click(dayTarget("Legs", "Tue, Aug 25"));
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(DRIFT);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/moved from/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a 400 in the server's words and keeps the pending moves for the client to adjust", async () => {
    stubFetch(400, { success: false, error: "That day already has a logged workout" });
    render(<TrainingWeekLayout />);

    fireEvent.click(chip("Legs")!);
    fireEvent.click(dayTarget("Legs", "Tue, Aug 25"));
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("That day already has a logged workout");
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(screen.getByText(/moved from Thu/)).toBeInTheDocument();
  });

  it("Reset drops every pending move", () => {
    render(<TrainingWeekLayout />);

    fireEvent.click(chip("Legs")!);
    fireEvent.click(dayTarget("Legs", "Tue, Aug 25"));
    expect(screen.getByText(/moved from Thu/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByText(/moved from/)).toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it("tapping the day a picked-up session already sits on just puts it down", () => {
    render(<TrainingWeekLayout />);

    fireEvent.click(chip("Legs")!);
    fireEvent.click(dayTarget("Legs", "Thu, Aug 27"));

    expect(screen.queryByText(/moved from/)).toBeNull();
    expect(screen.getByText("Tap a session, then the day to move it to.")).toBeInTheDocument();
    expect(chip("Legs")).not.toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it("renders nothing when the week has no sessions", () => {
    mockUseSWR.mockReturnValue(weekResponse([]));
    render(<TrainingWeekLayout />);
    expect(screen.queryByTestId("training-week-layout")).toBeNull();
  });
});
