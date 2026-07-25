import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

  it("renders the Edit-plan primary only when onEditPlan is provided (Job 2 seam)", () => {
    ctx.value = { plan: { id: "p1", name: "PPL", frequencyPerWeek: 4 } };
    renderHero();
    expect(screen.queryByRole("button", { name: /Edit plan/ })).toBeNull();
    cleanup();

    renderHero({ onEditPlan: vi.fn() });
    expect(screen.getByRole("button", { name: /Edit plan/ })).toBeInTheDocument();
  });
});
