import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

import {
  ExerciseTrackerBlock,
  type PrescribedExerciseView,
} from "./exercise-tracker-block";

function makeExercise(
  overrides: Partial<PrescribedExerciseView> = {},
): PrescribedExerciseView {
  return {
    id: "x-1",
    name: "Bench Press",
    sets: 3,
    repsTarget: "8-12",
    rpeTarget: 8,
    isWarmup: false,
    ...overrides,
  };
}

describe("ExerciseTrackerBlock", () => {
  it("renders N set rows matching exercise.sets", () => {
    render(<ExerciseTrackerBlock index={0} exercise={makeExercise({ sets: 3 })} />);
    expect(screen.getAllByTestId("set-row")).toHaveLength(3);
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });

  it("renders 4 set rows when sets is 4", () => {
    render(<ExerciseTrackerBlock index={0} exercise={makeExercise({ sets: 4 })} />);
    expect(screen.getAllByTestId("set-row")).toHaveLength(4);
  });

  it("shows 'No sets prescribed' and renders no rows when sets is 0", () => {
    render(
      <ExerciseTrackerBlock
        index={0}
        exercise={makeExercise({ sets: 0, name: "Foam Roll", isWarmup: true })}
      />,
    );
    expect(screen.queryAllByTestId("set-row")).toHaveLength(0);
    expect(screen.getByText(/no sets prescribed/i)).toBeInTheDocument();
    expect(screen.getByText("Foam Roll")).toBeInTheDocument();
  });
});
