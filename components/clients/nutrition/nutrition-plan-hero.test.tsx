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

  it("titles itself with the client's training program", () => {
    render(<NutritionPlanHero onOpenSettings={vi.fn()} />);

    expect(screen.getByText("Nutrition plan")).toBeInTheDocument();
    expect(screen.getByText("4 Week training program")).toBeInTheDocument();
    // A plan that is running shows no queued line.
    expect(screen.queryByText(/Starts/)).toBeNull();
  });

  it("falls back to the plan's own start date when the client has no program", () => {
    state.builder = {
      hasPlan: true,
      trainingPlanName: null,
      nutritionData: { effectiveFrom: "2026-07-27", scheduledFor: null },
    };
    render(<NutritionPlanHero onOpenSettings={vi.fn()} />);

    // Asserts the title ladder picked the date branch and formatted the right
    // day — not the month's abbreviation width, which is the shared formatter's
    // business and varies with the ICU build.
    expect(screen.getByText(/^Active since 27 Jul/)).toBeInTheDocument();
  });

  it("announces a queued plan from the server-resolved scheduledFor", () => {
    state.builder = {
      hasPlan: true,
      trainingPlanName: "4 Week training program",
      nutritionData: { effectiveFrom: "2026-08-12", scheduledFor: "2026-08-12" },
    };
    const { container } = render(<NutritionPlanHero onOpenSettings={vi.fn()} />);

    expect(container.textContent).toContain("Starts");
    expect(container.textContent).toContain("12 Aug");
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
