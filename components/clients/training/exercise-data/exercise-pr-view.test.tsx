import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExercisePrView } from "./exercise-pr-view";
import type { ExercisePR } from "@/types/training";

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
  it("renders PR cards ordered by reps ascending", () => {
    const data = [
      makePR({ reps: 5, weight: 100 }),
      makePR({ reps: 1, weight: 120 }),
      makePR({ reps: 3, weight: 110 }),
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

  it("renders correct weight and date", () => {
    const data = [makePR({ reps: 1, weight: 120, date: "2026-03-15T00:00:00Z" })];

    render(<ExercisePrView data={data} isLoading={false} />);

    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("Mar 15, 2026")).toBeInTheDocument();
  });
});
