import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/contexts/training-builder-context", () => ({
  useTrainingBuilderContext: () => ctx.value,
}));
// The accurate hero + the calendar are exercised by their own tests; stub them
// so this test isolates the right panel's plan/empty-state branching.
vi.mock("@/components/clients/training/training-summary-hero", () => ({
  TrainingSummaryHero: ({ clientId }: { clientId: string }) => (
    <div data-testid="summary-hero">{clientId}</div>
  ),
}));
vi.mock("../calendar/training-calendar-view", () => ({
  TrainingCalendarView: () => <div data-testid="calendar" />,
}));

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    editMode: false,
    isLoading: false,
    loadError: null,
    isGenerating: false,
    phases: [],
    clientTimezone: "UTC",
    fetchPlan: vi.fn(),
    plan: null,
    ...overrides,
  };
}

describe("TrainingBuilderRightPanel (Plans tab hero)", () => {
  beforeEach(() => cleanup());

  it("renders the shared accurate summary hero when a plan exists (not the old dayOfWeek strip)", () => {
    ctx.value = baseCtx({ plan: { id: "plan-1", name: "PPL" } });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    expect(screen.getByTestId("summary-hero")).toHaveTextContent("client-1");
    // The inaccurate strip's labels are gone.
    expect(screen.queryByText("This Week")).toBeNull();
    expect(screen.queryByText("Total Volume")).toBeNull();
    expect(screen.queryByText("No training plan yet")).toBeNull();
    expect(screen.getByTestId("calendar")).toBeInTheDocument();
  });

  it("shows the empty-state CTA (repointed to the library) when there is no plan", () => {
    ctx.value = baseCtx({ plan: null });
    render(
      <TrainingBuilderRightPanel clientId="client-1" onOpenGenerator={vi.fn()} />,
    );

    expect(screen.getByText("No training plan yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Browse programs/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("summary-hero")).toBeNull();
  });
});
