import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

import { SessionPicker } from "./session-picker";

type SessionEntry = {
  id: string;
  name: string;
  focus: string | null;
  orderIndex: number;
  isRest: boolean;
  estimatedDurationMinutes: number | null;
  exercises: never[];
};

function planResponse(sessions: SessionEntry[]) {
  return {
    data: {
      success: true,
      data: {
        planId: "p1",
        planName: "Plan",
        sessions,
      },
    },
    isLoading: false,
    error: undefined,
  };
}

const session = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  id: "s1",
  name: "Push",
  focus: "Chest",
  orderIndex: 0,
  isRest: false,
  estimatedDurationMinutes: null,
  exercises: [],
  ...over,
});

describe("SessionPicker", () => {
  beforeEach(() => cleanup());

  it("lists active-plan sessions (rest entries excluded) and fires onSelect", () => {
    mockUseSWR.mockReturnValue(
      planResponse([
        session({ id: "s1", name: "Push" }),
        session({ id: "rest", name: "Rest Day", isRest: true }),
      ]),
    );
    const onSelect = vi.fn();
    render(<SessionPicker onSelect={onSelect} onCancel={vi.fn()} />);

    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.queryByText("Rest Day")).toBeNull();

    fireEvent.click(screen.getByText("Push"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("fires onCancel when Cancel is clicked", () => {
    mockUseSWR.mockReturnValue(planResponse([session()]));
    const onCancel = vi.fn();
    render(<SessionPicker onSelect={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders the picker container while loading", () => {
    mockUseSWR.mockReturnValue({ data: undefined, isLoading: true, error: undefined });
    render(<SessionPicker onSelect={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId("session-picker")).toBeInTheDocument();
  });
});
