import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PastRoadmapsSection } from "./past-roadmaps-section";
import type { Phase, Roadmap } from "@/types/roadmap";

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({
  default: mockUseSWR,
  // PhaseReviewDrawer (rendered via PhaseCard) uses useSWRConfig for the
  // nutrition-calendar invalidation on transition success.
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

type RoadmapWithPhases = Roadmap & { phases: Phase[] };

function makePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: "p-1",
    roadmapId: "r-1",
    clientId: "client-1",
    name: "Cut Block",
    orderIndex: 0,
    status: "active",
    milestones: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRoadmap(
  overrides: Partial<RoadmapWithPhases> = {}
): RoadmapWithPhases {
  return {
    id: "r-1",
    clientId: "client-1",
    coachId: "coach-1",
    name: "Old Program",
    status: "archived",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    phases: [makePhase()],
    ...overrides,
  };
}

function setSWR(roadmaps: RoadmapWithPhases[]) {
  mockUseSWR.mockReturnValue({
    data: { success: true, data: roadmaps },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  });
}

describe("PastRoadmapsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there are no past roadmaps", () => {
    setSWR([]);
    const { container } = render(
      <PastRoadmapsSection clientId="client-1" weightUnit="lbs" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists past roadmaps and expands phases read-only", async () => {
    const user = userEvent.setup();
    setSWR([makeRoadmap()]);
    render(<PastRoadmapsSection clientId="client-1" weightUnit="lbs" />);

    expect(screen.getByText("Past roadmaps")).toBeInTheDocument();

    // Expand the section → the roadmap row appears
    await user.click(screen.getByText("Past roadmaps"));
    expect(screen.getByText("Old Program")).toBeInTheDocument();

    // Expand the roadmap → its phase shows, with no edit affordances (read-only)
    await user.click(screen.getByText("Old Program"));
    expect(screen.getByText("Cut Block")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Complete Phase/i })
    ).not.toBeInTheDocument();
  });
});
