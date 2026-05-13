import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PhaseCompletionCard } from "./phase-completion-card";

const swrCall = vi.fn();
const mutateMock = vi.fn();

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, _fetcher: unknown, _opts: unknown) => swrCall(key),
}));

function fixture() {
  return {
    success: true,
    data: {
      phaseId: "ph-1",
      phaseName: "Cut Phase 1",
      coachReflection: "Solid block — keep pushing.",
      phaseSummary: {
        adherence: {
          training: { percentage: 85, completed: 12 },
        },
      },
      endDate: "2026-04-30",
      weightUnit: "lbs" as const,
      nextPhaseName: "Build Phase",
      milestones: [
        { id: "m1", text: "Hit protein target", completed: true, completed_at: "2026-03-01" },
        { id: "m2", text: "12 sessions complete", completed: true, completed_at: "2026-04-15" },
        { id: "m3", text: "Drop 4 lbs", completed: false, completed_at: null },
      ],
    },
  };
}

beforeEach(() => {
  swrCall.mockReset();
  mutateMock.mockReset();
  swrCall.mockImplementation(() => ({
    data: fixture(),
    error: undefined,
    isLoading: false,
    mutate: mutateMock,
  }));
  cleanup();
});

describe("PhaseCompletionCard", () => {
  it("renders coach reflection and stats summary", () => {
    render(<PhaseCompletionCard />);

    expect(screen.getByText("Cut Phase 1")).toBeInTheDocument();
    expect(screen.getByText(/Solid block — keep pushing\./)).toBeInTheDocument();
    expect(screen.getByText(/Training:\s*85%/)).toBeInTheDocument();
    expect(screen.getAllByText("2/3 milestones").length).toBeGreaterThan(0);
  });

  it("dismisses by POSTing the phaseId to /api/client/phase-completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PhaseCompletionCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/client/phase-completion");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ phaseId: "ph-1" });
  });
});
