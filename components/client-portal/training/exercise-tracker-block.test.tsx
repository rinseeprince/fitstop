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

// The prescribed load has to reach the weight input as its placeholder. This is
// the editable (FormModeBlock) path — the static path above never had it.
import { useForm } from "react-hook-form";
import type { LogFormValues } from "./log-form-types";

function FormHarness({ exercise }: { exercise: PrescribedExerciseView }) {
  const { control, register, setValue, getValues } = useForm<LogFormValues>({
    defaultValues: {
      completionQuality: "",
      notes: "",
      exercises: [
        {
          trainingExerciseId: exercise.id,
          exerciseName: exercise.name,
          isSwapped: false,
          skipped: false,
          notes: "",
          isUnplanned: false,
          sets: Array.from({ length: exercise.sets }, () => ({
            reps: "",
            weight: "",
            rpe: "",
            weightKg: null,
          })),
        },
      ],
    },
  });
  return (
    <ExerciseTrackerBlock
      index={0}
      exercise={exercise}
      formContext={{ control, register, setValue, getValues, isUnplanned: false }}
    />
  );
}

describe("prescribed load placeholder", () => {
  const withLoad = makeExercise({
    sets: 4,
    setSpecs: Array.from({ length: 4 }, (_, i) => ({
      set_number: i + 1,
      set_type: "working",
      reps_min: 6,
      reps_max: 10,
      reps_target: null,
      load_type: "absolute",
      load_value: 100,
      rpe_target: 8,
      tempo: null,
      rest_seconds: 180,
      drops: null,
    })) as never,
  });

  it("puts the coach's absolute load on the weight input", () => {
    render(<FormHarness exercise={withLoad} />);
    const inputs = screen.getAllByLabelText(/weight/i);
    expect(inputs[0]).toHaveAttribute("placeholder", "100kg");
  });

  it("shows nothing when the coach prescribed no load", () => {
    render(<FormHarness exercise={makeExercise({ sets: 2 })} />);
    const inputs = screen.getAllByLabelText(/weight/i);
    expect(inputs[0]).toHaveAttribute("placeholder", "");
  });
});
