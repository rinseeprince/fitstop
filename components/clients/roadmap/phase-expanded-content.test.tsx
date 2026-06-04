import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhaseExpandedContent } from "./phase-expanded-content";
import type { Phase } from "@/types/roadmap";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function makePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: "phase-1",
    roadmapId: "roadmap-1",
    clientId: "client-1",
    name: "Block",
    orderIndex: 0,
    status: "active",
    milestones: [
      {
        id: "m-1",
        text: "Hit 100kg squat",
        completed: false,
        completed_at: null,
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("PhaseExpandedContent milestone read-only", () => {
  beforeEach(() => {
    mockUseSWR.mockReturnValue({
      data: { success: true, data: [] },
      isLoading: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("toggles a milestone (fires a request) when editable", async () => {
    const user = userEvent.setup();
    render(
      <PhaseExpandedContent
        phase={makePhase()}
        clientId="client-1"
        weightUnit="lbs"
        onMutate={vi.fn()}
      />
    );

    await user.click(screen.getByText("Hit 100kg squat"));

    expect(fetch).toHaveBeenCalled();
  });

  it("does not toggle a milestone when read-only", async () => {
    const user = userEvent.setup();
    render(
      <PhaseExpandedContent
        phase={makePhase()}
        clientId="client-1"
        weightUnit="lbs"
        onMutate={vi.fn()}
        isReadOnly
      />
    );

    await user.click(screen.getByText("Hit 100kg squat"));

    expect(fetch).not.toHaveBeenCalled();
  });
});
