import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseSearchSelect, type ExerciseMetricOption } from "./exercise-search-select";
import type { ExerciseListItem } from "@/types/training";

// cmdk uses ResizeObserver and scrollIntoView
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = vi.fn();

function makeExercise(
  overrides: Partial<ExerciseListItem> = {},
): ExerciseListItem {
  return {
    exerciseId: "ex-1",
    name: "Bench Press",
    logCount: 12,
    lastLoggedDate: "2026-03-15",
    exerciseType: "strength",
    ...overrides,
  };
}

// The view hands the hero the lenses the exercise offers; a Strength lift's six
const STRENGTH_LENSES: ExerciseMetricOption[] = [
  { value: "weight", label: "Weight" },
  { value: "e1rm", label: "e1RM" },
  { value: "volume", label: "Volume" },
  { value: "rpe", label: "RPE" },
  { value: "compliance", label: "Compliance" },
  { value: "prs", label: "PRs" },
];

const defaultProps = {
  exercises: undefined as ExerciseListItem[] | undefined,
  isLoading: false,
  selectedExerciseId: null,
  selectedExerciseName: null,
  onSelect: vi.fn(),
  onSelectAll: vi.fn(),
  options: STRENGTH_LENSES,
  metric: "weight" as const,
  onMetricChange: vi.fn(),
};

describe("ExerciseSearchSelect", () => {
  it("reads All exercises with no exercise picked, and has no lens row there", () => {
    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={[makeExercise()]}
        options={[]}
      />,
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("All exercises");
    expect(screen.queryByRole("button", { pressed: true })).toBeNull();
    expect(screen.queryByRole("button", { pressed: false })).toBeNull();
  });

  it("draws the lens row's hairline only when there are lenses", () => {
    const { container, rerender } = render(<ExerciseSearchSelect {...defaultProps} exercises={[makeExercise()]} options={[]} />);
    // The slab holds the picker alone: no hairline, no empty row
    const slab = container.firstElementChild as HTMLElement;
    expect(slab.children).toHaveLength(1);
    rerender(<ExerciseSearchSelect {...defaultProps} exercises={[makeExercise()]} selectedExerciseId="ex-1" />);
    expect((container.firstElementChild as HTMLElement).children).toHaveLength(2);
  });

  it("offers All exercises first in the picker, ticked while it is picked", async () => {
    const user = userEvent.setup();
    const onSelectAll = vi.fn();
    const onSelect = vi.fn();
    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={[makeExercise({ name: "Bench Press" }), makeExercise({ exerciseId: "ex-2", name: "Squat" })]}
        onSelect={onSelect}
        onSelectAll={onSelectAll}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["All exercises", "Bench Press12 logs", "Squat12 logs"]);
    expect(options[0].querySelector("svg")).not.toBeNull();

    await user.click(options[0]);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ticks the exercise picked, not All exercises", async () => {
    const user = userEvent.setup();
    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={[makeExercise({ exerciseId: "ex-1", name: "Bench Press" })]}
        selectedExerciseId="ex-1"
        selectedExerciseName="Bench Press"
      />,
    );

    await user.click(screen.getByRole("combobox"));
    const [all, bench] = screen.getAllByRole("option");
    expect(all.querySelector("svg")).toBeNull();
    expect(bench.querySelector("svg")).not.toBeNull();
  });

  it("renders 'EXERCISE' label on the card", () => {
    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={[makeExercise()]}
      />,
    );

    expect(screen.getByText("Exercise")).toBeInTheDocument();
  });

  it("renders selected exercise name from list match", () => {
    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={[makeExercise({ exerciseId: "ex-1", name: "Bench Press" })]}
        selectedExerciseId="ex-1"
      />,
    );

    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });

  it("renders selectedExerciseName when list has not loaded", () => {
    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={undefined}
        selectedExerciseName="Squat"
      />,
    );

    expect(screen.getByText("Squat")).toBeInTheDocument();
  });

  it("holds the slab's own height while loading: with the lens row for an exercise, without it on All exercises", () => {
    const { container, rerender } = render(
      <ExerciseSearchSelect {...defaultProps} isLoading={true} selectedExerciseId="ex-1" selectedExerciseName="Bench Press" />,
    );
    expect(container.querySelector("[data-slot='skeleton']")).toHaveClass("h-[125px]");

    rerender(<ExerciseSearchSelect {...defaultProps} isLoading={true} options={[]} />);
    expect(container.querySelector("[data-slot='skeleton']")).toHaveClass("h-[75px]");
  });

  it("shows exercise list with log counts in dropdown", async () => {
    const user = userEvent.setup();
    const exercises = [
      makeExercise({ name: "Bench Press", logCount: 12 }),
      makeExercise({ exerciseId: "ex-2", name: "Squat", logCount: 8 }),
    ];

    render(
      <ExerciseSearchSelect {...defaultProps} exercises={exercises} />,
    );

    await user.click(screen.getByRole("combobox"));

    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Squat")).toBeInTheDocument();
  });

  it("calls onSelect when an exercise is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const exercises = [makeExercise({ name: "Bench Press" })];

    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={exercises}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByText("Bench Press"));

    expect(onSelect).toHaveBeenCalledWith(exercises[0]);
  });

  it("renders the metric lens row inside the hero with the active lens pressed", () => {
    render(
      <ExerciseSearchSelect {...defaultProps} exercises={[makeExercise()]} />,
    );

    for (const label of ["Weight", "e1RM", "Volume", "RPE", "Compliance", "PRs"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Weight" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Volume" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls onMetricChange when a lens is clicked", async () => {
    const user = userEvent.setup();
    const onMetricChange = vi.fn();

    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={[makeExercise()]}
        onMetricChange={onMetricChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Volume" }));

    expect(onMetricChange).toHaveBeenCalledWith("volume");
  });
});

describe("ExerciseSearchSelect — the lenses are the view's", () => {
  it("renders exactly the options it is given, in their order", () => {
    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={[makeExercise({ name: "Running", exerciseType: "endurance" })]}
        options={[
          { value: "pace", label: "Pace" },
          { value: "distance", label: "Distance" },
          { value: "prs", label: "PRs" },
        ]}
        metric="pace"
      />,
    );
    const lenses = screen.getAllByRole("button", { name: /^(Pace|Distance|PRs|Weight)$/ });
    expect(lenses.map((b) => b.textContent)).toEqual(["Pace", "Distance", "PRs"]);
  });
});
