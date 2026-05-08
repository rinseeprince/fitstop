import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseSearchSelect } from "./exercise-search-select";
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
    ...overrides,
  };
}

const defaultProps = {
  exercises: undefined as ExerciseListItem[] | undefined,
  isLoading: false,
  selectedExerciseId: null,
  selectedExerciseName: null,
  onSelect: vi.fn(),
};

describe("ExerciseSearchSelect", () => {
  it("renders placeholder when no exercise is selected", () => {
    render(
      <ExerciseSearchSelect
        {...defaultProps}
        exercises={[makeExercise()]}
      />,
    );

    expect(screen.getByText("Select exercise...")).toBeInTheDocument();
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

  it("renders loading skeleton when isLoading is true", () => {
    const { container } = render(
      <ExerciseSearchSelect {...defaultProps} isLoading={true} />,
    );

    const skeleton = container.querySelector("[data-slot='skeleton']");
    expect(skeleton).toBeInTheDocument();
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
    expect(screen.getByText("12 logs")).toBeInTheDocument();
    expect(screen.getByText("Squat")).toBeInTheDocument();
    expect(screen.getByText("8 logs")).toBeInTheDocument();
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

  it("renders singular 'log' for logCount of 1", async () => {
    const user = userEvent.setup();
    const exercises = [makeExercise({ logCount: 1 })];

    render(
      <ExerciseSearchSelect {...defaultProps} exercises={exercises} />,
    );

    await user.click(screen.getByRole("combobox"));

    expect(screen.getByText("1 log")).toBeInTheDocument();
  });
});
