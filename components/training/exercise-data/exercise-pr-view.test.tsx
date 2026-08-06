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

function makePR(overrides: Partial<ExercisePR> = {}): ExercisePR {
  return {
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
      makePR({ reps: 5, weight: 100, date: "2026-02-01T00:00:00Z" }),
      makePR({ reps: 1, weight: 120, date: "2026-04-01T00:00:00Z" }),
      makePR({ reps: 3, weight: 110, date: "2026-03-01T00:00:00Z" }),
    ];

    render(<ExercisePrView data={data} isLoading={false} />);

    const labels = screen.getAllByText(/Rep Max/);
    expect(labels[0].textContent).toBe("1 Rep Max");
    expect(labels[1].textContent).toBe("3 Rep Max");
    expect(labels[2].textContent).toBe("5 Rep Max");
  });

  it("renders 'New' badge when isRecent is true", () => {
    const data = [makePR({ isRecent: true })];

    render(<ExercisePrView data={data} isLoading={false} />);

    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("does not render 'New' badge when isRecent is false", () => {
    const data = [makePR({ isRecent: false })];

    render(<ExercisePrView data={data} isLoading={false} />);

    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("renders empty state when no PRs exist", () => {
    render(<ExercisePrView data={[]} isLoading={false} />);

    expect(
      screen.getByText(/No personal records yet/),
    ).toBeInTheDocument();
  });

  it("renders loading skeletons", () => {
    const { container } = render(
      <ExercisePrView data={undefined} isLoading={true} />,
    );

    const skeletons = container.querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBe(4);
  });

  it("renders a metric viewer's PR in kilograms", () => {
    const data = [makePR({ reps: 1, weight: 120, date: "2026-03-15T00:00:00Z" })];

    render(<ExercisePrView data={data} isLoading={false} />);

    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("kg")).toBeInTheDocument();
    expect(screen.getByText("Mar 15, 2026")).toBeInTheDocument();
  });

  // A PR is a barbell load, so it goes through formatLoad and snaps to a
  // loadable increment: 120 kg is 264.55 lbs, which nobody can put on a bar.
  it("converts and SNAPS the same PR for an imperial viewer", () => {
    units.preference = "imperial";
    const data = [makePR({ reps: 1, weight: 120, date: "2026-03-15T00:00:00Z" })];

    render(<ExercisePrView data={data} isLoading={false} />);

    expect(screen.getByText("265")).toBeInTheDocument();
    expect(screen.getByText("lbs")).toBeInTheDocument();
    expect(screen.queryByText("264.55")).toBeNull();
  });
});
