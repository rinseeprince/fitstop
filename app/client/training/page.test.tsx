import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const { state, mockReplace } = vi.hoisted(() => ({
  state: { search: "" },
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: mockReplace }),
}));

vi.mock("@/components/client-portal/training/set-tracker", () => ({
  SetTracker: (props: { sessionId?: string; eventId?: string }) => (
    <div data-testid="set-tracker" data-session={props.sessionId ?? ""} />
  ),
}));

// The picker is a list; the page decides what a pick means. The stub offers
// one still-scheduled Thursday session and one already-done Monday session.
vi.mock("@/components/client-portal/training/session-picker", () => ({
  SessionPicker: (props: {
    onPick: (s: unknown) => void;
    error?: string | null;
  }) => (
    <div data-testid="session-picker">
      <button
        type="button"
        onClick={() =>
          props.onPick({
            eventId: "ev-thu",
            sessionId: "s-thu",
            name: "Legs",
            focus: null,
            date: "2026-05-09",
            state: "upcoming",
            isScheduled: true,
          })
        }
      >
        pick-legs
      </button>
      <button
        type="button"
        onClick={() =>
          props.onPick({
            eventId: "ev-mon",
            sessionId: "s-mon",
            name: "Push",
            focus: null,
            date: "2026-05-04",
            state: "done",
            isScheduled: false,
          })
        }
      >
        pick-push-done
      </button>
      {props.error ? <p role="alert">{props.error}</p> : null}
    </div>
  ),
}));

import ClientTrainingDetailPage from "./page";

describe("ClientTrainingDetailPage", () => {
  beforeEach(() => {
    cleanup();
    state.search = "";
    mockReplace.mockReset();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("renders empty-state card when neither eventId nor date is present", () => {
    render(<ClientTrainingDetailPage />);
    expect(screen.getByText(/no workout selected/i)).toBeInTheDocument();
    expect(screen.queryByTestId("set-tracker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-picker")).not.toBeInTheDocument();
  });

  it("renders the tracker when eventId is present", () => {
    state.search = "eventId=e1&date=2026-05-08";
    render(<ClientTrainingDetailPage />);
    expect(screen.getByTestId("set-tracker")).toBeInTheDocument();
  });

  it("renders the picker when date is present but eventId is missing", () => {
    state.search = "date=2026-05-08";
    render(<ClientTrainingDetailPage />);
    expect(screen.getByTestId("session-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("set-tracker")).not.toBeInTheDocument();
  });

  it("a still-scheduled pick MOVES the session to this day, then opens it here", async () => {
    state.search = "date=2026-05-08";
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { moved: [] } }),
    } as unknown as Response);

    render(<ClientTrainingDetailPage />);
    fireEvent.click(screen.getByText("pick-legs"));

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/client/training/events/layout",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          moves: [{ eventId: "ev-thu", fromDate: "2026-05-09", toDate: "2026-05-08" }],
        }),
      }),
    );
    expect(mockReplace).toHaveBeenCalledWith("/client/training?eventId=ev-thu&date=2026-05-08");
  });

  it("an already-done pick is logged in place as an extra — no move, no navigation", () => {
    state.search = "date=2026-05-08";
    render(<ClientTrainingDetailPage />);
    fireEvent.click(screen.getByText("pick-push-done"));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId("set-tracker")).toHaveAttribute("data-session", "s-mon");
  });

  it("shows the server's refusal in its own words and stays on the picker", async () => {
    state.search = "date=2026-05-08";
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({ success: false, error: "Fri, May 8 already has a session" }),
    } as unknown as Response);

    render(<ClientTrainingDetailPage />);
    fireEvent.click(screen.getByText("pick-legs"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Fri, May 8 already has a session"),
    );
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-picker")).toBeInTheDocument();
  });
});
