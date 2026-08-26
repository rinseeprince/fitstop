import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({
  default: mockUseSWR,
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import { SessionPicker } from "./session-picker";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";

function weekResponse(sessions: ClientTrainingWeekSession[]) {
  return {
    data: {
      success: true,
      data: {
        weekStart: "2026-08-24",
        weekEnd: "2026-08-30",
        today: "2026-08-26",
        sessions,
      },
    },
    isLoading: false,
    error: undefined,
  };
}

const session = (over: Partial<ClientTrainingWeekSession> = {}): ClientTrainingWeekSession => ({
  eventId: "ev-thu",
  sessionId: "s-thu",
  name: "Legs",
  focus: "Lower",
  date: "2026-08-27",
  state: "upcoming",
  isScheduled: true,
  ...over,
});

describe("SessionPicker", () => {
  beforeEach(() => cleanup());

  it("reads the week containing the day being acted on", () => {
    mockUseSWR.mockReturnValue(weekResponse([]));
    render(<SessionPicker date="2026-08-26" onPick={vi.fn()} onCancel={vi.fn()} />);

    expect(mockUseSWR).toHaveBeenCalledWith(
      "/api/client/training/week?date=2026-08-26",
      expect.anything(),
      expect.anything(),
    );
  });

  it("lists this week's sessions with their day and state, and hands the whole entry to onPick", () => {
    const legs = session();
    mockUseSWR.mockReturnValue(
      weekResponse([
        session({ eventId: "ev-mon", sessionId: "s-mon", name: "Push", date: "2026-08-24", state: "done", isScheduled: false }),
        legs,
      ]),
    );
    const onPick = vi.fn();
    render(<SessionPicker date="2026-08-26" onPick={onPick} onCancel={vi.fn()} />);

    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Legs")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getByText(/Thu, Aug 27/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Legs"));
    expect(onPick).toHaveBeenCalledWith(legs);
  });

  it("does not offer the event the client is already on", () => {
    mockUseSWR.mockReturnValue(
      weekResponse([session({ eventId: "ev-wed", name: "Pull", date: "2026-08-26", state: "today" }), session()]),
    );
    render(
      <SessionPicker date="2026-08-26" excludeEventId="ev-wed" onPick={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.queryByText("Pull")).toBeNull();
    expect(screen.getByText("Legs")).toBeInTheDocument();
  });

  it("shows the server's refusal and disables picks while one is being applied", () => {
    mockUseSWR.mockReturnValue(weekResponse([session()]));
    render(
      <SessionPicker
        date="2026-08-26"
        onPick={vi.fn()}
        onCancel={vi.fn()}
        error="Sat, Aug 29 already has a session"
        busy
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Sat, Aug 29 already has a session");
    expect(screen.getByText("Legs").closest("button")).toBeDisabled();
  });

  it("says so when the week has nothing to pick from", () => {
    mockUseSWR.mockReturnValue(weekResponse([]));
    render(<SessionPicker date="2026-08-26" onPick={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/no sessions in your week/i)).toBeInTheDocument();
  });

  it("fires onCancel when Cancel is clicked", () => {
    mockUseSWR.mockReturnValue(weekResponse([session()]));
    const onCancel = vi.fn();
    render(<SessionPicker date="2026-08-26" onPick={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders the picker container while loading", () => {
    mockUseSWR.mockReturnValue({ data: undefined, isLoading: true, error: undefined });
    render(<SessionPicker date="2026-08-26" onPick={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId("session-picker")).toBeInTheDocument();
  });
});
