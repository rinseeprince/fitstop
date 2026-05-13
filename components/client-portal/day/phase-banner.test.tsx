import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PhaseBanner } from "./phase-banner";

describe("PhaseBanner", () => {
  beforeEach(() => cleanup());

  it("renders nothing when phase is null", () => {
    const { container } = render(<PhaseBanner phase={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an active phase with name, Week N, goal, and link to /client/program", () => {
    render(
      <PhaseBanner
        phase={{
          id: "p1",
          name: "Strength Block",
          weekInPhase: 3,
          goal: "Build base",
          state: "active",
        }}
      />,
    );

    expect(screen.getByText("Strength Block")).toBeInTheDocument();
    expect(screen.getByText("Week 3")).toBeInTheDocument();
    expect(screen.getByText("Build base")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/client/program");
  });

  it("does not render a Week label when weekInPhase is null", () => {
    render(
      <PhaseBanner
        phase={{
          id: "p1",
          name: "Hypertrophy",
          weekInPhase: null,
          goal: null,
          state: "active",
        }}
      />,
    );

    expect(screen.getByText("Hypertrophy")).toBeInTheDocument();
    expect(screen.queryByText(/^Week\s/)).toBeNull();
  });

  it("renders a transitioning phase as 'Next: NAME' with 'Starting soon'", () => {
    render(
      <PhaseBanner
        phase={{
          id: "p2",
          name: "Power Cycle",
          weekInPhase: null,
          goal: "Heavy compounds",
          state: "transitioning",
        }}
      />,
    );

    expect(screen.getByText("Next: Power Cycle")).toBeInTheDocument();
    expect(screen.getByText("Starting soon")).toBeInTheDocument();
    expect(screen.getByText("Heavy compounds")).toBeInTheDocument();
  });
});
