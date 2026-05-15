import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { NutritionPlanCard } from "./nutrition-plan-card";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("NutritionPlanCard", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the 'Nutrition plan' title", () => {
    render(<NutritionPlanCard />);
    expect(screen.getByText("Nutrition plan")).toBeInTheDocument();
  });

  it("links to the drill-in page", () => {
    render(<NutritionPlanCard />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/client/program/nutrition");
  });
});
