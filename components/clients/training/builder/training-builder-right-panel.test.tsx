import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TrainingBuilderRightPanel } from "./training-builder-right-panel";

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/contexts/training-builder-context", () => ({
  useTrainingBuilderContext: () => ctx.value,
}));
// The panel writes no address of its own. The router is mocked, with the
// plan editor's `?plan=` on the address, so a reader or a writer coming back
// shows here.
const { push, replace, search } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: { current: new URLSearchParams("tab=training&training=plans") },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, back: vi.fn() }),
  useSearchParams: () => search.current,
}));
// The delete clears the Training tab's plan read — it renders a definite
// answer — and refreshes the training area the calendar reads.
const { clearTrainingPlan, invalidateTrainingData } = vi.hoisted(() => ({
  clearTrainingPlan: vi.fn().mockResolvedValue(undefined),
  invalidateTrainingData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-training-plan", () => ({
  useClearTrainingPlan: () => clearTrainingPlan,
}));
vi.mock("@/hooks/use-calendar-events", () => ({
  useInvalidateTrainingData: () => invalidateTrainingData,
}));
// The hero + the calendar are exercised by their own tests; stub them so this
// test isolates the right panel's composition (hero always mounted — it owns
// the plan/empty/pending branching itself — plus the calendar wiring). The
// hero's Edit plan is kept, so the id it hands the host shows.
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
// The calendar stub counts its mounts: the pane staying up through a refresh
// means the calendar is never unmounted.
const calendarMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("../calendar/training-calendar-view", async () => {
  const { useEffect } = await import("react");
  return {
    TrainingCalendarView: (props: {
      onDeleteFuture?: () => void;
      planPending?: boolean;
      onUpdate: () => void;
    }) => {
      useEffect(() => {
        calendarMounts.count += 1;
      }, []);
      return (
        <div
          data-testid="calendar"
          data-can-delete-future={props.onDeleteFuture ? "yes" : "no"}
          data-plan-pending={String(props.planPending ?? false)}
        >
          {props.onDeleteFuture && (
            <button type="button" onClick={props.onDeleteFuture}>
              Delete training plan
            </button>
          )}
          <button type="button" onClick={props.onUpdate}>
            Calendar updated
          </button>
        </div>
      );
    },
  };
});

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

const PLAN = {
  id: "plan-1",
  name: "Upper Lower",
  effectiveFrom: "2026-09-07",
  effectiveUntil: "2026-10-04",
};

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    editMode: false,
    setEditMode: vi.fn(),
    isPending: false,
    loadError: null,
    clientTimezone: "UTC",
    refresh: vi.fn(),
    plan: null,
    ...overrides,
  };
}

describe("TrainingBuilderRightPanel (Plans tab surface)", () => {
  beforeEach(() => {
    cleanup();
    push.mockClear();
    replace.mockClear();
    clearTrainingPlan.mockClear();
    invalidateTrainingData.mockClear();
    calendarMounts.count = 0;
    search.current = new URLSearchParams("tab=training&training=plans");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts the hero and calendar with a plan, and enables the Delete-future trigger", () => {
    ctx.value = baseCtx({ plan: PLAN });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    expect(screen.getByTestId("plan-hero")).toHaveTextContent("client-1");
    expect(screen.getByTestId("calendar")).toHaveAttribute(
      "data-can-delete-future",
      "yes",
    );
    expect(screen.getByTestId("calendar")).toHaveAttribute("data-plan-pending", "false");
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

  it("a refresh in flight keeps the pane: no page loader, the hero and the calendar stay mounted", () => {
    // Never settles: the revalidation the calendar asked for is still running,
    // and the read keeps its answer meanwhile (hooks/use-training-plan.test.ts).
    const refresh = vi.fn(() => new Promise<never>(() => {}));
    ctx.value = baseCtx({ plan: PLAN, refresh });
    render(<TrainingBuilderRightPanel clientId="client-1" />);
    const hero = screen.getByTestId("plan-hero");
    const calendar = screen.getByTestId("calendar");

    fireEvent.click(screen.getByRole("button", { name: "Calendar updated" }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Loading training plan…")).toBeNull();
    expect(screen.getByTestId("plan-hero")).toBe(hero);
    expect(screen.getByTestId("calendar")).toBe(calendar);
    expect(calendarMounts.count).toBe(1);
  });

  it("renders its structure while the plan read is pending — no page loader", () => {
    ctx.value = baseCtx({ isPending: true, plan: null });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    expect(screen.queryByText("Loading training plan…")).toBeNull();
    expect(screen.getByTestId("plan-hero")).toBeInTheDocument();
    // The calendar is told the read is pending, and the Delete-plan trigger is
    // held — the calendar disables it — so it never leaves and comes back.
    expect(screen.getByTestId("calendar")).toHaveAttribute("data-plan-pending", "true");
    expect(screen.getByTestId("calendar")).toHaveAttribute(
      "data-can-delete-future",
      "yes",
    );
  });

  it("shows the error card only when the first load failed, and its retry refreshes the read", () => {
    const refresh = vi.fn();
    ctx.value = baseCtx({ loadError: "Failed to fetch training plan", refresh });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    expect(screen.getByText("Failed to load training plan")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch training plan")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-hero")).toBeNull();
    expect(screen.queryByTestId("calendar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("Edit plan hands the host the id of the plan the hero shows", () => {
    ctx.value = baseCtx({ plan: PLAN });
    const onEditPlan = vi.fn();
    render(<TrainingBuilderRightPanel clientId="client-1" onEditPlan={onEditPlan} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    expect(onEditPlan).toHaveBeenCalledTimes(1);
    expect(onEditPlan).toHaveBeenCalledWith("plan-1");
  });

  it("offers no Edit plan without a plan, or without a host to open the editor", () => {
    ctx.value = baseCtx({ plan: null });
    render(<TrainingBuilderRightPanel clientId="client-1" onEditPlan={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Edit plan" })).toBeNull();
    cleanup();

    ctx.value = baseCtx({ plan: PLAN });
    render(<TrainingBuilderRightPanel clientId="client-1" />);
    expect(screen.queryByRole("button", { name: "Edit plan" })).toBeNull();
  });

  it("reads no address and mounts no editor of its own: Edit plan is the host's to open", () => {
    search.current = new URLSearchParams("tab=training&training=plans&plan=plan-1");
    ctx.value = baseCtx({ plan: PLAN });
    render(<TrainingBuilderRightPanel clientId="client-1" onEditPlan={vi.fn()} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    const source = readFileSync(join(__dirname, "training-builder-right-panel.tsx"), "utf8");
    expect(source).not.toContain("next/navigation");
  });

  it("a calendar write revalidates the plan read in place", () => {
    const refresh = vi.fn();
    ctx.value = baseCtx({ plan: PLAN, refresh });
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Calendar updated" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(clearTrainingPlan).not.toHaveBeenCalled();
  });

  it("Delete plan clears the plan read and refreshes the calendar's area, instead of refetching the read", async () => {
    const refresh = vi.fn();
    ctx.value = baseCtx({ plan: PLAN, refresh });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, plansCleared: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Delete training plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete plan" }));

    await waitFor(() => expect(clearTrainingPlan).toHaveBeenCalledWith("client-1"));
    expect(fetchMock).toHaveBeenCalledWith("/api/clients/client-1/training", {
      method: "DELETE",
    });
    // The calendar stays mounted through the delete, so the sessions it
    // removed leave only when the training area refetches.
    expect(invalidateTrainingData).toHaveBeenCalledWith("client-1");
    expect(calendarMounts.count).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a failed delete clears nothing and keeps the confirm open", async () => {
    ctx.value = baseCtx({ plan: PLAN });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Failed to clear future sessions" }),
      }),
    );
    render(<TrainingBuilderRightPanel clientId="client-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Delete training plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete plan" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete plan" })).toBeEnabled(),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(clearTrainingPlan).not.toHaveBeenCalled();
    expect(invalidateTrainingData).not.toHaveBeenCalled();
  });
});
