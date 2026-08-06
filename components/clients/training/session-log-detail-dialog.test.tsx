import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionLogDetailDialog } from "./session-log-detail-dialog";
import type { SessionLog, ExerciseLog, SetLog } from "@/types/training";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


// ---------------------------------------------------------------------------
// SWR mock
// ---------------------------------------------------------------------------

const { mockUseSWR } = vi.hoisted(() => ({ mockUseSWR: vi.fn() }));
vi.mock("swr", () => ({ default: mockUseSWR }));
vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeSessionLog(overrides: Partial<SessionLog> = {}): SessionLog {
  return {
    id: "sl-1",
    clientId: "client-1",
    trainingSessionId: "ts-1",
    trainingEventId: null,
    completedAt: "2026-04-06T08:00:00Z",
    completionQuality: "full",
    notes: null,
    weekStartDate: "2026-04-06",
    prescribedSessionSnapshot: { name: "Push Day", focus: "Upper Body" },
    createdAt: "2026-04-06T08:00:00Z",
    updatedAt: "2026-04-06T08:00:00Z",
    ...overrides,
  };
}

function makeSetLog(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: "set-1",
    exerciseLogId: "el-1",
    setNumber: 1,
    setType: "working",
    reps: 10,
    weight: 60,
    rpe: null,
    createdAt: "2026-04-06T08:00:00Z",
    updatedAt: "2026-04-06T08:00:00Z",
    ...overrides,
  };
}

function makeExerciseLog(overrides: Partial<ExerciseLog> = {}): ExerciseLog {
  return {
    id: "el-1",
    sessionLogId: "sl-1",
    trainingExerciseId: "te-1",
    exerciseId: "ex-1",
    completed: true,
    notes: null,
    performedName: null,
    prescribedExerciseSnapshot: { name: "Bench Press", sets: 3, reps_min: 8, reps_max: 12 },
    sets: [
      makeSetLog({ id: "set-1", setNumber: 1, reps: 10, weight: 60 }),
      makeSetLog({ id: "set-2", setNumber: 2, reps: 8, weight: 65 }),
    ],
    createdAt: "2026-04-06T08:00:00Z",
    updatedAt: "2026-04-06T08:00:00Z",
    ...overrides,
  };
}

function setupSWR(options: {
  sessionLog?: SessionLog;
  exerciseLogs?: ExerciseLog[];
  isLoading?: boolean;
  error?: Error | null;
}) {
  mockUseSWR.mockReturnValue({
    data: options.isLoading
      ? undefined
      : {
          success: true,
          data: {
            sessionLog: options.sessionLog ?? makeSessionLog(),
            exerciseLogs: options.exerciseLogs ?? [],
          },
        },
    isLoading: options.isLoading ?? false,
    error: options.error ?? null,
  });
}

const defaultProps = {
  clientId: "client-1",
  sessionLogId: "sl-1",
  open: true,
  onOpenChange: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionLogDetailDialog", () => {
  it("renders quick-logged label when exerciseLogs is empty", () => {
    setupSWR({
      sessionLog: makeSessionLog({ notes: "Felt good", completionQuality: "full" }),
      exerciseLogs: [],
    });

    render(<SessionLogDetailDialog {...defaultProps} />);

    expect(
      screen.getByText(/logged this session as complete without per-set detail/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Felt good")).toBeInTheDocument();
  });

  it("renders session name from prescribed snapshot", () => {
    setupSWR({
      sessionLog: makeSessionLog({
        prescribedSessionSnapshot: { name: "Pull Day" },
      }),
      exerciseLogs: [],
    });

    render(<SessionLogDetailDialog {...defaultProps} />);

    expect(screen.getByText("Pull Day")).toBeInTheDocument();
  });

  it("renders detailed display with per-set actuals", () => {
    setupSWR({
      exerciseLogs: [
        makeExerciseLog({
          sets: [
            makeSetLog({ setNumber: 1, reps: 10, weight: 60 }),
            makeSetLog({ setNumber: 2, reps: 8, weight: 65 }),
          ],
        }),
      ],
    });

    render(<SessionLogDetailDialog {...defaultProps} />);

    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("65")).toBeInTheDocument();
  });

  it("renders swapped exercise with both names", () => {
    setupSWR({
      exerciseLogs: [
        makeExerciseLog({
          performedName: "Dumbbell Bench",
          prescribedExerciseSnapshot: { name: "Barbell Bench Press" },
        }),
      ],
    });

    render(<SessionLogDetailDialog {...defaultProps} />);

    expect(screen.getByText("Dumbbell Bench")).toBeInTheDocument();
    expect(
      screen.getByText(/Prescribed Barbell Bench Press · Performed Dumbbell Bench/),
    ).toBeInTheDocument();
  });

  it("renders per-set RPE when present", () => {
    setupSWR({
      exerciseLogs: [
        makeExerciseLog({
          sets: [
            makeSetLog({ setNumber: 1, reps: 10, weight: 60, rpe: 7.5 }),
          ],
        }),
      ],
    });

    render(<SessionLogDetailDialog {...defaultProps} />);

    expect(screen.getByText("7.5")).toBeInTheDocument();
  });

  it("renders dash placeholder when RPE is null", () => {
    setupSWR({
      exerciseLogs: [
        makeExerciseLog({
          sets: [
            makeSetLog({ setNumber: 1, reps: 10, weight: 60, rpe: null }),
          ],
        }),
      ],
    });

    render(<SessionLogDetailDialog {...defaultProps} />);

    // RPE column should have dash placeholders (—)
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("uses prescribedSessionSnapshot name when trainingSessionId is null (orphaned)", () => {
    setupSWR({
      sessionLog: makeSessionLog({
        trainingSessionId: null,
        prescribedSessionSnapshot: { name: "Old Program Day 1" },
      }),
      exerciseLogs: [
        makeExerciseLog({
          trainingExerciseId: null,
          prescribedExerciseSnapshot: { name: "Squat" },
          performedName: null,
        }),
      ],
    });

    render(<SessionLogDetailDialog {...defaultProps} />);

    expect(screen.getByText("Old Program Day 1")).toBeInTheDocument();
    expect(screen.getByText("Squat")).toBeInTheDocument();
  });

  it("uses prescribedExerciseSnapshot name when trainingExerciseId is null", () => {
    setupSWR({
      exerciseLogs: [
        makeExerciseLog({
          trainingExerciseId: null,
          performedName: null,
          prescribedExerciseSnapshot: { name: "Deadlift" },
        }),
      ],
    });

    render(<SessionLogDetailDialog {...defaultProps} />);

    expect(screen.getByText("Deadlift")).toBeInTheDocument();
  });

  it("renders loading skeletons when isLoading is true", () => {
    setupSWR({ isLoading: true });

    render(<SessionLogDetailDialog {...defaultProps} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    // Skeleton elements render inside a portal on document.body
    const skeletons = document.body.querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders error message on fetch failure", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
    });

    render(<SessionLogDetailDialog {...defaultProps} />);

    expect(screen.getByText(/failed to load session details/i)).toBeInTheDocument();
  });

  it("calls onExerciseDrillDown with exerciseId and name when exercise name is clicked", async () => {
    const user = userEvent.setup();
    const onDrillDown = vi.fn();

    setupSWR({
      exerciseLogs: [
        makeExerciseLog({
          exerciseId: "ex-1",
          performedName: null,
          prescribedExerciseSnapshot: { name: "Bench Press" },
        }),
      ],
    });

    render(
      <SessionLogDetailDialog
        {...defaultProps}
        onExerciseDrillDown={onDrillDown}
      />,
    );

    await user.click(screen.getByText("Bench Press"));

    expect(onDrillDown).toHaveBeenCalledWith("ex-1", "Bench Press");
  });

  it("calls onExerciseDrillDown with null exerciseId when exerciseId is null", async () => {
    const user = userEvent.setup();
    const onDrillDown = vi.fn();

    setupSWR({
      exerciseLogs: [
        makeExerciseLog({
          exerciseId: null,
          performedName: "Custom Exercise",
          prescribedExerciseSnapshot: null,
        }),
      ],
    });

    render(
      <SessionLogDetailDialog
        {...defaultProps}
        onExerciseDrillDown={onDrillDown}
      />,
    );

    await user.click(screen.getByText("Custom Exercise"));

    expect(onDrillDown).toHaveBeenCalledWith(null, "Custom Exercise");
  });
});
