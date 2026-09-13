import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/contexts/training-builder-context", () => ({
  useTrainingBuilderContext: () => ctx.value,
}));
// The amendment editor is a place: `?amend=<planId>` opens it, Edit plan
// pushes it. The router and the count are mocked; the address is driven.
const { push, replace, back, search, coachHistory } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  search: { current: new URLSearchParams("tab=training&training=plans") },
  coachHistory: { current: false },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, back }),
  useSearchParams: () => search.current,
}));
vi.mock("@/lib/coach-history", () => ({
  hasCoachHistory: () => coachHistory.current,
}));
vi.mock("./plan-amendment-overlay", () => ({
  PlanAmendmentOverlay: ({ open, planId }: { open: boolean; planId: string | null }) => (
    <div data-testid="amendment" data-open={String(open)} data-plan={planId ?? ""} />
  ),
}));
// The hero + the calendar are exercised by their own tests; stub them so this
// test isolates the right panel's composition (hero always mounted — it owns
// the plan/empty branching itself now — plus the calendar wiring). The hero's
// Edit plan is the amendment's one entry point, so the stub keeps it.
vi.mock("@/components/clients/training/training-plan-hero", () => ({
  TrainingPlanHero: ({
    clientId,
    onEditPlan,
  }: {
    clientId: string;
    onEditPlan?: () => void;
  }) => (
    <div data-testid="plan-hero">
      {clientId}
      {onEditPlan && (
        <button type="button" onClick={onEditPlan}>
          Edit plan
        </button>
      )}
    </div>
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

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    editMode: false,
    setEditMode: vi.fn(),
    isLoading: false,
    loadError: null,
    clientTimezone: "UTC",
    fetchPlan: vi.fn(),
    plan: null,
    ...overrides,
  };
}

describe("TrainingBuilderRightPanel (Plans tab surface)", () => {
  beforeEach(() => {
    cleanup();
    push.mockClear();
    replace.mockClear();
    back.mockClear();
    search.current = new URLSearchParams("tab=training&training=plans");
    coachHistory.current = false;
  });

  it("?amend= opens the amendment editor for the plan on the calendar — a place", () => {
    search.current = new URLSearchParams("tab=training&training=plans&amend=plan-1");
    ctx.value = baseCtx({ plan: { id: "plan-1", name: "PPL" } });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    expect(screen.getByTestId("amendment")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("amendment")).toHaveAttribute("data-plan", "plan-1");
  });

  it("an amend address for another plan opens nothing", () => {
    search.current = new URLSearchParams("tab=training&training=plans&amend=plan-9");
    ctx.value = baseCtx({ plan: { id: "plan-1", name: "PPL" } });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    expect(screen.getByTestId("amendment")).toHaveAttribute("data-open", "false");
  });

  it("Edit plan pushes the amendment's address, keeping the scroll position", () => {
    ctx.value = baseCtx({ plan: { id: "plan-1", name: "PPL" } });
    render(<TrainingBuilderRightPanel clientId="client-1" />);
    expect(screen.getByTestId("amendment")).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("?tab=training&training=plans&amend=plan-1", {
      scroll: false,
    });
    expect(replace).not.toHaveBeenCalled();
  });

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
