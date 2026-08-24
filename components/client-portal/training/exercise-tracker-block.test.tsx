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
import { seedDefaultValues, type LogFormValues } from "./log-form-types";

function FormHarness({ exercise }: { exercise: PrescribedExerciseView }) {
  const { control, register, setValue, getValues } = useForm<LogFormValues>({
    // Seed through the REAL path. Hand-rolling the rows here meant the harness
    // could disagree with what the app builds — and the row count is precisely
    // where drop-set flattening lives.
    defaultValues: seedDefaultValues({
      prescribedViews: [exercise],
      sessionLog: null,
      exerciseLogs: [],
      viewer: "metric",
    }),
  });
  return (
    <ExerciseTrackerBlock
      index={0}
      exercise={exercise}
      formContext={{ control, register, setValue, getValues, isUnplanned: false }}
    />
  );
}

describe("prescribed load column", () => {
  const spec = (over: Record<string, unknown>) => ({
    set_number: 1,
    set_type: "working",
    reps_min: 6,
    reps_max: 10,
    reps_target: null,
    load_type: null,
    load_value: null,
    rpe_target: 8,
    tempo: null,
    rest_seconds: 180,
    drops: null,
    ...over,
  });

  it("renders an absolute load in its own read-only cell, not on the weight input", () => {
    const exercise = makeExercise({
      sets: 2,
      setSpecs: [
        spec({ set_number: 1, load_type: "absolute", load_value: 100 }),
        spec({ set_number: 2, load_type: "absolute", load_value: 100 }),
      ] as never,
    });
    render(<FormHarness exercise={exercise} />);

    expect(screen.getByTestId("prescribed-load-0-0")).toHaveTextContent("100kg");
    // The weight box is the CLIENT's entry, always in their unit, never the
    // prescription — a percentage could not live there.
    expect(screen.getAllByLabelText(/weight/i)[0]).not.toHaveAttribute(
      "placeholder",
    );
  });

  it("renders a percentage prescription as a percentage", () => {
    const exercise = makeExercise({
      sets: 1,
      setSpecs: [spec({ load_type: "pct_1rm", load_value: 60 })] as never,
    });
    render(<FormHarness exercise={exercise} />);
    expect(screen.getByTestId("prescribed-load-0-0")).toHaveTextContent("60% 1RM");
  });

  it("shows a dash when the coach prescribed no load", () => {
    render(<FormHarness exercise={makeExercise({ sets: 2 })} />);
    expect(screen.getByTestId("prescribed-load-0-0")).toHaveTextContent("—");
  });

  it("gives every set its OWN reps hint rather than one exercise-level range", () => {
    const exercise = makeExercise({
      sets: 3,
      setSpecs: [
        spec({ set_number: 1, set_type: "warmup", reps_min: 15, reps_max: 20 }),
        spec({ set_number: 2, reps_min: 10, reps_max: 12 }),
        spec({ set_number: 3, reps_min: 8, reps_max: 10 }),
      ] as never,
    });
    render(<FormHarness exercise={exercise} />);
    const reps = screen.getAllByLabelText(/reps/i);
    expect(reps[0]).toHaveAttribute("placeholder", "15-20");
    expect(reps[1]).toHaveAttribute("placeholder", "10-12");
    expect(reps[2]).toHaveAttribute("placeholder", "8-10");
  });

  it("expands a drop set into its top set plus one row per drop", () => {
    const exercise = makeExercise({
      sets: 1,
      setSpecs: [
        spec({
          set_number: 1,
          set_type: "drop",
          load_type: "absolute",
          load_value: 80,
          drops: [{ weight: 60, reps: 8 }, { weight: 40, reps: 8 }],
        }),
      ] as never,
    });
    render(<FormHarness exercise={exercise} />);
    expect(screen.getAllByTestId("set-row")).toHaveLength(3);
    expect(screen.getByTestId("prescribed-load-0-1")).toHaveTextContent("60kg");
    expect(screen.getByTestId("prescribed-load-0-2")).toHaveTextContent("40kg");
  });
});
