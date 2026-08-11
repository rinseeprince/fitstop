import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NutritionPlanHero } from "./nutrition-plan-hero";

// Mutable holder (hoisted so the mock factory can read it).
const state = vi.hoisted(() => ({
  builder: {} as Record<string, unknown>,
}));

vi.mock("@/contexts/nutrition-builder-context", () => ({
  useNutritionBuilderContext: () => state.builder,
}));

describe("NutritionPlanHero", () => {
  beforeEach(() => {
    cleanup();
    state.builder = {
      hasPlan: true,
      trainingPlanName: "4 Week training program",
      nutritionData: { effectiveFrom: "2026-07-27", scheduledFor: null },
    };
  });

  it("titles itself with the client's training program, dating the plan underneath", () => {
    const { container } = render(<NutritionPlanHero onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Nutrition plan")).toBeInTheDocument();
    expect(screen.getByText("4 Week training program")).toBeInTheDocument();
    // A plan that is running shows no queued line — but it DOES show its date:
    // with the title slot taken by the program name, the "Active since" line is
    // the only place the coach can see when the current numbers took effect.
    expect(screen.queryByText(/Starts/)).toBeNull();
    expect(container.textContent).toContain("Active since");
    expect(container.textContent).toContain("27 Jul");
  });

  it("falls back to the plan's own start date when the client has no program — once, not twice", () => {
    state.builder = {
      hasPlan: true,
      trainingPlanName: null,
      nutritionData: { effectiveFrom: "2026-07-27", scheduledFor: null },
    };
    const { container } = render(<NutritionPlanHero onOpenSettings={vi.fn()} />);

    // Asserts the title ladder picked the date branch and formatted the right
    // day — not the month's abbreviation width, which is the shared formatter's
    // business and varies with the ICU build.
    expect(screen.getByText(/^Active since 27 Jul/)).toBeInTheDocument();
    // The title already carries the date, so the sub-line must not repeat it.
    expect(container.textContent?.match(/Active since/g)).toHaveLength(1);
  });

  it("announces a queued FIRST plan as Starts — nothing runs in the interim", () => {
    state.builder = {
      hasPlan: true,
      trainingPlanName: "4 Week training program",
      nutritionData: {
        effectiveFrom: "2026-08-12",
        scheduledFor: "2026-08-12",
        hasCurrentTargets: false,
      },
    };
    const { container } = render(<NutritionPlanHero onOpenSettings={vi.fn()} />);

    expect(container.textContent).toContain("Starts");
    expect(container.textContent).toContain("12 Aug");
    expect(container.textContent).not.toContain("New targets from");
  });

  it("announces a queued CHANGE as New targets from — the current numbers keep running", () => {
    // An existing client: their today still has a nutrition event (the old
    // prescription), so the hero must not read as if no plan is active.
    state.builder = {
      hasPlan: true,
      trainingPlanName: "4 Week training program",
      nutritionData: {
        effectiveFrom: "2026-08-12",
        scheduledFor: "2026-08-12",
        hasCurrentTargets: true,
      },
    };
    const { container } = render(<NutritionPlanHero onOpenSettings={vi.fn()} />);

    expect(container.textContent).toContain("New targets from");
    expect(container.textContent).toContain("12 Aug");
    expect(container.textContent).not.toContain("Starts");
    // Queued line only — never the Active-since line at the same time.
    expect(container.textContent).not.toContain("Active since");
  });

  it("owns the empty branch: muted title + the Generate CTA", () => {
    state.builder = { hasPlan: false, trainingPlanName: null, nutritionData: null };
    render(<NutritionPlanHero onOpenSettings={vi.fn()} />);

    expect(screen.getByText("No active nutrition plan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate plan" })).toBeInTheDocument();
  });

  it("labels the action Regenerate once a plan exists", () => {
    render(<NutritionPlanHero onOpenSettings={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeInTheDocument();
  });
});
