import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/contexts/training-builder-context", () => ({
  useTrainingBuilderContext: () => ctx.value,
}));
// The hero + the calendar are exercised by their own tests; stub them so this
// test isolates the right panel's composition (hero always mounted — it owns
// the plan/empty branching itself now — plus the calendar wiring).
vi.mock("@/components/clients/training/training-plan-hero", () => ({
  TrainingPlanHero: ({ clientId }: { clientId: string }) => (
    <div data-testid="plan-hero">{clientId}</div>
  ),
}));
vi.mock("../calendar/training-calendar-view", () => ({
  TrainingCalendarView: (props: { onDeleteFuture?: () => void }) => (
    <div
      data-testid="calendar"
      data-can-delete-future={props.onDeleteFuture ? "yes" : "no"}
    />
  ),
}));

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    editMode: false,
    setEditMode: vi.fn(),
    isLoading: false,
    loadError: null,
    phases: [],
    clientTimezone: "UTC",
    fetchPlan: vi.fn(),
    plan: null,
    ...overrides,
  };
}

describe("TrainingBuilderRightPanel (Plans tab surface)", () => {
  beforeEach(() => cleanup());

  it("mounts the hero and calendar with a plan, and enables the Delete-future trigger", () => {
    ctx.value = baseCtx({ plan: { id: "plan-1", name: "PPL" } });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    expect(screen.getByTestId("plan-hero")).toHaveTextContent("client-1");
    expect(screen.getByTestId("calendar")).toHaveAttribute(
      "data-can-delete-future",
      "yes",
    );
  });

  it("still mounts the hero with no plan (it owns the empty branch) but withholds Delete-future", () => {
    ctx.value = baseCtx({ plan: null });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    expect(screen.getByTestId("plan-hero")).toBeInTheDocument();
    expect(screen.getByTestId("calendar")).toHaveAttribute(
      "data-can-delete-future",
      "no",
    );
  });

  it("shows only the loader while the plan is loading", () => {
    ctx.value = baseCtx({ isLoading: true });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    expect(screen.queryByTestId("plan-hero")).toBeNull();
    expect(screen.queryByTestId("calendar")).toBeNull();
  });
});
