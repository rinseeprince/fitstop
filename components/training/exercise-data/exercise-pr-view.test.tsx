import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ExercisePrView } from "./exercise-pr-view";
import type { ExercisePR } from "@/types/training";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

function repMax(overrides: Partial<Extract<ExercisePR, { kind: "rep_max" }>> = {}): ExercisePR {
  return {
    kind: "rep_max",
    reps: 5,
    weight: 100,
    date: "2026-03-15T00:00:00Z",
    isRecent: false,
    ...overrides,
  };
}

describe("ExercisePrView", () => {
  beforeEach(() => {
    cleanup();
    units.preference = "metric";
  });

  it("renders PR cards sorted by recency (newest first)", () => {
    const data = [
      repMax({ reps: 5, weight: 100, date: "2026-02-01T00:00:00Z" }),
      repMax({ reps: 1, weight: 120, date: "2026-04-01T00:00:00Z" }),
      repMax({ reps: 3, weight: 110, date: "2026-03-01T00:00:00Z" }),
    ];

    render(<ExercisePrView data={data} exerciseType="strength" isLoading={false} />);

    const labels = screen.getAllByText(/Rep Max/);
    expect(labels[0].textContent).toBe("1 Rep Max");
    expect(labels[1].textContent).toBe("3 Rep Max");
    expect(labels[2].textContent).toBe("5 Rep Max");
    // One kind: the plain grid, no heading
    expect(screen.queryByText("Rep maxes")).toBeNull();
  });

  it("renders 'New' badge when isRecent is true", () => {
    render(<ExercisePrView data={[repMax({ isRecent: true })]} exerciseType="strength" isLoading={false} />);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("does not render 'New' badge when isRecent is false", () => {
    render(<ExercisePrView data={[repMax({ isRecent: false })]} exerciseType="strength" isLoading={false} />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("renders the empty state with the type's own hint", () => {
    render(<ExercisePrView data={[]} exerciseType="strength" isLoading={false} />);
    expect(screen.getByText(/No personal records yet\. Log sets with weight/)).toBeInTheDocument();
    cleanup();
    render(<ExercisePrView data={[]} exerciseType="endurance" isLoading={false} />);
    expect(screen.getByText(/Log a distance and a time/)).toBeInTheDocument();
  });

  it("renders loading skeletons", () => {
    const { container } = render(
      <ExercisePrView data={undefined} exerciseType="strength" isLoading={true} />,
    );
    const skeletons = container.querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBe(4);
  });

  it("renders a metric viewer's PR in kilograms", () => {
    render(
      <ExercisePrView
        data={[repMax({ reps: 1, weight: 120, date: "2026-03-15T00:00:00Z" })]}
        exerciseType="strength"
        isLoading={false}
      />,
    );
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("kg")).toBeInTheDocument();
    expect(screen.getByText("Mar 15, 2026")).toBeInTheDocument();
  });

  // A PR is a barbell load, so it goes through formatLoad and snaps to a
  // loadable increment: 120 kg is 264.55 lbs, which nobody can put on a bar.
  it("converts and SNAPS the same PR for an imperial viewer", () => {
    units.preference = "imperial";
    render(
      <ExercisePrView
        data={[repMax({ reps: 1, weight: 120, date: "2026-03-15T00:00:00Z" })]}
        exerciseType="strength"
        isLoading={false}
      />,
    );
    expect(screen.getByText("265")).toBeInTheDocument();
    expect(screen.getByText("lbs")).toBeInTheDocument();
    expect(screen.queryByText("264.55")).toBeNull();
  });

  it("renders best times per distance as a clock, labelled by the distance in the viewer's units", () => {
    const data: ExercisePR[] = [
      { kind: "best_time", distanceMeters: 1000, durationSeconds: 222.1, date: "2026-03-15T00:00:00Z", isRecent: true },
      { kind: "best_time", distanceMeters: 5000, durationSeconds: 1505, date: "2026-03-01T00:00:00Z", isRecent: false },
    ];
    render(<ExercisePrView data={data} exerciseType="erg" isLoading={false} />);
    expect(screen.getByText("1 km")).toBeInTheDocument();
    expect(screen.getByText("3:42.1")).toBeInTheDocument();
    expect(screen.getByText("5 km")).toBeInTheDocument();
    expect(screen.getByText("25:05")).toBeInTheDocument();
    expect(screen.queryByText("Best times")).toBeNull();
  });

  it("puts a heading over each kind when an exercise has bests of more than one, its own kind first", () => {
    const data: ExercisePR[] = [
      repMax({ reps: 5, weight: 10, date: "2026-03-10T00:00:00Z" }),
      { kind: "best_reps", reps: 15, date: "2026-03-15T00:00:00Z", isRecent: false },
    ];
    const { container } = render(
      <ExercisePrView data={data} exerciseType="bodyweight" isLoading={false} />,
    );
    const groups = [...container.querySelectorAll("section")].map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Best set", "Rep maxes"]);
    expect(screen.getByText("Rep maxes")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("reps")).toBeInTheDocument();
  });

  it("renders a carry by its distance and load, and a hold as a clock", () => {
    const data: ExercisePR[] = [
      { kind: "heaviest_carry", distanceMeters: 40, weight: 64, date: "2026-03-15T00:00:00Z", isRecent: false },
      { kind: "longest_hold", durationSeconds: 120, date: "2026-03-15T00:00:00Z", isRecent: false },
    ];
    render(<ExercisePrView data={data} exerciseType="carry_sled" isLoading={false} />);
    expect(screen.getByText("40 m carry")).toBeInTheDocument();
    expect(screen.getByText("64")).toBeInTheDocument();
    // The kind's heading and its one card share the words
    expect(screen.getAllByText("Longest hold")).toHaveLength(2);
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });
});
