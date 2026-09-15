import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TrainingPlanHero } from "./training-plan-hero";

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/contexts/training-builder-context", () => ({
  useTrainingBuilderContext: () => ctx.value,
}));

function renderHero(props: Partial<Parameters<typeof TrainingPlanHero>[0]> = {}) {
  return render(<TrainingPlanHero clientId="client-1" {...props} />);
}

describe("TrainingPlanHero", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the empty branch with the library CTA in the lens-row register", () => {
    ctx.value = { plan: null };
    const onOpenGenerator = vi.fn();
    const { container } = renderHero({ onOpenGenerator });

    expect(screen.getByText("No active training plan")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Browse programs/ }),
    ).toBeInTheDocument();
    // Owner call: hero actions adopt the Exercise Data hero's lens-row design —
    // the primary is the active-lens teal chip, not a filled button.
    expect(container.innerHTML).toContain("rgba(13,148,136,0.15)");
    expect(container.innerHTML).not.toContain("0b7f75");
  });

  it("renders the plan branch as name + actions with no stat row (owner call)", () => {
    ctx.value = {
      plan: { id: "p1", name: "PPL", frequencyPerWeek: 4, programDurationWeeks: 8 },
    };
    renderHero({ onOpenGenerator: vi.fn() });

    expect(screen.getByText("PPL")).toBeInTheDocument();
    expect(screen.getByText("Training plan")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Apply program/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/adherence/)).toBeNull();
    expect(screen.queryByText(/this wk/)).toBeNull();
  });

  it("renders the Edit-plan primary only when onEditPlan is provided, and fires it", () => {
    ctx.value = { plan: { id: "p1", name: "PPL", frequencyPerWeek: 4 } };
    renderHero();
    expect(screen.queryByRole("button", { name: /Edit plan/ })).toBeNull();
    cleanup();

    const onEditPlan = vi.fn();
    renderHero({ onEditPlan });
    fireEvent.click(screen.getByRole("button", { name: /Edit plan/ }));
    expect(onEditPlan).toHaveBeenCalledTimes(1);
  });

  // The plan read answers with a running or a queued program, never an ended
  // one, so Edit plan has no state in which it is refused.
  it("never disables Edit plan, a queued program included", () => {
    ctx.value = {
      plan: { id: "p1", name: "PPL", frequencyPerWeek: 4 },
      scheduledFor: "2026-10-05",
    };
    renderHero({ onEditPlan: vi.fn() });

    const button = screen.getByRole("button", { name: /Edit plan/ });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("title");
  });

  // Until the plan read answers — the first load, or a cleared entry
  // refetching after an apply or a delete — the hero is its own frame with
  // placeholders and claims nothing: neither the plan the context may still
  // carry nor its absence, and no action that would act on either.
  it("claims nothing while the plan read is pending, even with a plan still in hand", () => {
    ctx.value = {
      isPending: true,
      plan: { id: "p1", name: "PPL", frequencyPerWeek: 4 },
      scheduledFor: "2026-10-05",
    };
    const { container } = renderHero({ onOpenGenerator: vi.fn(), onEditPlan: vi.fn() });

    // The frame is there: the eyebrow and a placeholder in the title's slot.
    expect(screen.getByText("Training plan")).toBeInTheDocument();
    expect(container.querySelector("h2 [data-slot='skeleton']")).not.toBeNull();
    // Nothing claimed.
    expect(screen.queryByText("PPL")).toBeNull();
    expect(screen.queryByText("No active training plan")).toBeNull();
    expect(screen.queryByText(/Starts/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit plan/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Apply program/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Browse programs/ })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
