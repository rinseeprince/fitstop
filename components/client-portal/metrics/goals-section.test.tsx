import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// units-context imports auth-context, which constructs the browser Supabase
// client at module load and throws without env vars.
const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference }),
}));

import { GoalsSection } from "./goals-section";

afterEach(() => {
  cleanup();
  units.preference = "metric";
});

// The client's Goals & Progress card says how far they are from each target in
// the words every goal card uses (`goalProgressChip`), so a client past the
// target never reads "to go" (docs/MEASUREMENT-LOG-PLAN.md commit 8d4).
describe("GoalsSection — how far from the target", () => {
  it("says how far under a lose-weight target a client past it is — never to go", () => {
    render(
      <GoalsSection
        client={{ goalWeight: 80.4, goalType: "lose_weight", goalStartWeight: 86.7, currentWeight: 78.2 }}
      />
    );

    expect(screen.getByText("2.2 kg under goal")).toBeInTheDocument();
    expect(screen.queryByText(/to go/)).not.toBeInTheDocument();
  });

  it("says how far to go while the client is short of it", () => {
    render(
      <GoalsSection
        client={{ goalWeight: 81.3, goalType: "lose_weight", goalStartWeight: 87.9, currentWeight: 84.6 }}
      />
    );

    expect(screen.getByText("3.3 kg to go")).toBeInTheDocument();
  });

  it("reads a type with no direction of its own from the goal's start reading", () => {
    // Maintain at 75.6 from 79.3: the target sits below the start, so 74.1 is past it.
    render(
      <GoalsSection client={{ goalWeight: 75.6, goalType: "maintain", goalStartWeight: 79.3, currentWeight: 74.1 }} />
    );

    expect(screen.getByText("1.5 kg under goal")).toBeInTheDocument();
  });

  it("says the same of body fat past a recomp's target", () => {
    render(
      <GoalsSection
        client={{
          goalBodyFatPercentage: 17.8,
          goalType: "recomposition",
          goalStartBodyFatPercentage: 24.1,
          currentBodyFatPercentage: 16.9,
        }}
      />
    );

    expect(screen.getByText("0.9% under goal")).toBeInTheDocument();
    expect(screen.queryByText(/to go/)).not.toBeInTheDocument();
  });

  it("says the goal is reached on it", () => {
    render(
      <GoalsSection client={{ goalWeight: 72.3, goalType: "build_muscle", goalStartWeight: 68.8, currentWeight: 72.3 }} />
    );

    expect(screen.getByText("Goal reached")).toBeInTheDocument();
  });

  it("measures in the client's own unit, between the two numbers it shows", () => {
    // 90.7 kg shows as 200.0 lbs and 89.4 kg as 197.1 lbs.
    units.preference = "imperial";
    render(
      <GoalsSection client={{ goalWeight: 90.7, goalType: "lose_weight", goalStartWeight: 95.3, currentWeight: 89.4 }} />
    );

    expect(screen.getByText("2.9 lbs under goal")).toBeInTheDocument();
  });
});
