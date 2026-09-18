import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionLogDetailDialog } from "./session-log-detail-dialog";
import { emptyLoggedActuals } from "@/utils/set-log-measures";
import type {
  SessionLog,
  ExerciseLog,
  SetLog,
  SessionLogPrescribedExercise,
  SessionLogPrescribedGroup,
} from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { STRAIGHT_SETS, type GroupSettings } from "@/utils/exercise-groups";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module. The
// viewer's units are switchable per test; every test starts metric.
const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
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

function spec(overrides: Partial<SetSpec> & { set_number: number }): SetSpec {
  return {
    set_type: "working",
    reps_min: null,
    reps_max: null,
    reps_target: null,
    load_type: null,
    load_min: null, load_max: null,
    rpe_min: null,
    rpe_max: null,
    tempo: null,
    rest_seconds: null,
    drops: null,
    ...overrides,
  };
}

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
    ...emptyLoggedActuals(),
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

function makePrescribed(
  overrides: Partial<SessionLogPrescribedExercise> = {},
): SessionLogPrescribedExercise {
  return {
    trainingExerciseId: "te-1",
    name: "Bench Press",
    snapshot: { name: "Bench Press", sets: 3, reps_min: 8, reps_max: 12 },
    ...overrides,
  };
}

/** A group of the prescription: straight sets of one unless settings say otherwise. */
function makeGroup(
  id: string,
  orderIndex: number,
  exercises: SessionLogPrescribedExercise[],
  settings: Partial<GroupSettings> = {},
): SessionLogPrescribedGroup {
  return { id, orderIndex, ...STRAIGHT_SETS, ...settings, exercises };
}

function setupSWR(options: {
  sessionLog?: SessionLog;
  exerciseLogs?: ExerciseLog[];
  prescribedGroups?: SessionLogPrescribedGroup[];
  performedSessionName?: string | null;
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
            prescribedGroups: options.prescribedGroups ?? [],
            performedSessionName: options.performedSessionName ?? null,
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

const rows = () => screen.getAllByTestId("logged-set-row");

/**
 * The cell under `header` in a set row: the coach's target (its top line) and
 * what the client did (its bottom line, whose text carries the words a screen
 * reader hears when it is outside the target).
 */
function measure(row: HTMLElement, header: string) {
  const table = row.closest("table") as HTMLElement;
  const headers = within(table)
    .getAllByRole("columnheader")
    .map((h) => h.textContent);
  const index = headers.indexOf(header);
  if (index < 0) throw new Error(`no "${header}" column in [${headers.join(", ")}]`);
  const [target, actual] = Array.from(within(row).getAllByRole("cell")[index].children) as HTMLElement[];
  return { target: (target.textContent ?? "").trim(), actual };
}

/** One lone exercise, logged against its snapshot. */
function setupExercise(snapshot: Record<string, unknown>, sets: SetLog[]) {
  setupSWR({
    exerciseLogs: [makeExerciseLog({ prescribedExerciseSnapshot: snapshot, sets })],
  });
}

const AMBER = "text-[#d97706]";
const RED = "text-[#c06060]";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionLogDetailDialog", () => {
  beforeEach(() => {
    units.preference = "metric";
  });

  describe("the fetch", () => {
    // A closing card is re-rendered from live props for its exit animation
    // (CONVENTIONS §7 → "No frame disagrees"), so the close must not drop the key.
    it("keys the fetch on the session log alone, so a closing dialog keeps its data", () => {
      setupSWR({});
      const url = "/api/clients/client-1/training/session-logs/sl-1";

      const { rerender } = render(<SessionLogDetailDialog {...defaultProps} />);
      expect(mockUseSWR.mock.lastCall?.[0]).toBe(url);

      rerender(<SessionLogDetailDialog {...defaultProps} open={false} />);
      expect(mockUseSWR.mock.lastCall?.[0]).toBe(url);
    });

    it("fetches nothing before the first session log is shown", () => {
      setupSWR({});

      render(<SessionLogDetailDialog {...defaultProps} sessionLogId={null} open={false} />);

      expect(mockUseSWR.mock.lastCall?.[0]).toBeNull();
    });
  });

  describe("shell", () => {
    it("renders the quick-logged label when nothing was prescribed or logged", () => {
      setupSWR({
        sessionLog: makeSessionLog({ notes: "Felt good", completionQuality: "full" }),
        exerciseLogs: [],
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(
        screen.getByText(/logged this session as complete without per-set detail/i),
      ).toBeInTheDocument();
      expect(screen.getByText("Full")).toBeInTheDocument();
      expect(screen.getByText("Felt good")).toBeInTheDocument();
    });

    it("renders session name from the prescribed snapshot", () => {
      setupSWR({
        sessionLog: makeSessionLog({ prescribedSessionSnapshot: { name: "Pull Day" } }),
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(screen.getByText("Pull Day")).toBeInTheDocument();
    });

    it("renders loading skeletons when isLoading is true", () => {
      setupSWR({ isLoading: true });

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
      const skeletons = document.body.querySelectorAll("[data-slot='skeleton']");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("renders an error message on fetch failure", () => {
      mockUseSWR.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error("Network error"),
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(screen.getByText(/failed to load session details/i)).toBeInTheDocument();
    });

    it("renders the session-level swap line", () => {
      setupSWR({
        sessionLog: makeSessionLog({ prescribedSessionSnapshot: { name: "Push Day" } }),
        performedSessionName: "Pull Day",
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(screen.getByText("Pull Day")).toBeInTheDocument();
      expect(screen.getByText(/Prescribed/)).toBeInTheDocument();
    });
  });

  describe("the prescription drives the rows", () => {
    it("renders every prescribed set, and marks the unlogged ones not done", () => {
      setupSWR({
        exerciseLogs: [
          makeExerciseLog({
            prescribedExerciseSnapshot: {
              name: "Bench Press",
              sets: 4,
              set_specs: [
                spec({ set_number: 1, reps_min: 8, reps_max: 12 }),
                spec({ set_number: 2, reps_min: 8, reps_max: 12 }),
                spec({ set_number: 3, reps_min: 8, reps_max: 12 }),
                spec({ set_number: 4, reps_min: 8, reps_max: 12 }),
              ],
            },
            sets: [makeSetLog({ setNumber: 1, reps: 10, weight: 60 })],
          }),
        ],
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      // Four prescribed rows, not one logged row.
      expect(rows()).toHaveLength(4);
      expect(screen.getAllByText("Logged")).toHaveLength(1);
      expect(screen.getAllByText("Not done")).toHaveLength(3);
    });

    it("aligns a logged set to the set it was prescribed as, not to its position", () => {
      setupSWR({
        exerciseLogs: [
          makeExerciseLog({
            prescribedExerciseSnapshot: {
              name: "Bench Press",
              sets: 4,
              set_specs: [
                spec({ set_number: 1, set_type: "warmup", reps_min: 15, reps_max: 15 }),
                spec({ set_number: 2, reps_min: 8, reps_max: 12 }),
                spec({ set_number: 3, reps_min: 8, reps_max: 12 }),
              ],
            },
            // The client did only the third row.
            sets: [makeSetLog({ setNumber: 3, reps: 9, weight: 70 })],
          }),
        ],
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [warmup, second, third] = rows();
      expect(within(warmup).getByText("Not done")).toBeInTheDocument();
      expect(within(second).getByText("Not done")).toBeInTheDocument();
      expect(within(third).getByText("Logged")).toBeInTheDocument();
      expect(within(third).getByText("70")).toBeInTheDocument();
      expect(within(third).getByText("9")).toBeInTheDocument();
    });

    it("distinguishes a ticked-but-empty set from a set that was not done", () => {
      setupSWR({
        exerciseLogs: [
          makeExerciseLog({
            prescribedExerciseSnapshot: {
              name: "Bench Press",
              sets: 2,
              set_specs: [spec({ set_number: 1 }), spec({ set_number: 2 })],
            },
            // Set 1 was ticked with no numbers recorded — doing the work is the
            // claim. Set 2 was not done at all.
            sets: [makeSetLog({ setNumber: 1, reps: null, weight: null, rpe: null })],
          }),
        ],
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [first, second] = rows();
      expect(within(first).getByText("Logged")).toBeInTheDocument();
      expect(within(second).getByText("Not done")).toBeInTheDocument();
    });

    it("keeps a logged set past the prescription", () => {
      setupSWR({
        exerciseLogs: [
          makeExerciseLog({
            prescribedExerciseSnapshot: {
              name: "Bench Press",
              sets: 2,
              set_specs: [spec({ set_number: 1 }), spec({ set_number: 2 })],
            },
            sets: [
              makeSetLog({ id: "s1", setNumber: 1, reps: 10, weight: 60 }),
              makeSetLog({ id: "s2", setNumber: 2, reps: 10, weight: 60 }),
              makeSetLog({ id: "s3", setNumber: 3, reps: 8, weight: 60 }),
            ],
          }),
        ],
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(rows()).toHaveLength(3);
      expect(screen.getAllByText("Logged")).toHaveLength(3);
    });
  });

  describe("target over actual", () => {
    it("gives each measure a column, the coach's target over what the client did", () => {
      setupExercise(
        {
          name: "Squat",
          sets: 1,
          set_specs: [
            spec({
              set_number: 1,
              reps_min: 5,
              reps_max: 5,
              load_type: "absolute",
              load_min: 100, load_max: 105,
              rpe_min: 8, rpe_max: 8,
            }),
          ],
        },
        [makeSetLog({ setNumber: 1, reps: 5, weight: 102.5, rpe: 8 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [set] = rows();
      expect(measure(set, "Load (kg)")).toMatchObject({ target: "100–105 kg" });
      expect(measure(set, "Load (kg)").actual).toHaveTextContent(/^102\.5$/);
      expect(measure(set, "Reps").target).toBe("5");
      expect(measure(set, "Reps").actual).toHaveTextContent(/^5$/);
      expect(measure(set, "RPE").target).toBe("8");
      // Inside every target: nothing is marked.
      for (const header of ["Load (kg)", "Reps", "RPE"]) {
        expect(measure(set, header).actual).not.toHaveClass(AMBER);
      }
      // The separate Prescribed column is gone.
      expect(screen.queryByText("Prescribed")).toBeNull();
    });

    it("marks a value outside its target amber, below as well as above", () => {
      setupExercise(
        {
          name: "Squat",
          sets: 1,
          set_specs: [
            spec({ set_number: 1, reps_min: 5, reps_max: 5, load_type: "absolute", load_min: 100, load_max: 105 }),
          ],
        },
        [makeSetLog({ setNumber: 1, reps: 4, weight: 107.5 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [set] = rows();
      expect(measure(set, "Reps").actual).toHaveClass(AMBER);
      expect(measure(set, "Reps").actual).toHaveTextContent("4, below target");
      expect(measure(set, "Load (kg)").actual).toHaveClass(AMBER);
      expect(measure(set, "Load (kg)").actual).toHaveTextContent("107.5, above target");
    });

    it("keeps today's red for an RPE two or more above, and amber for less", () => {
      setupExercise(
        {
          name: "Squat",
          sets: 3,
          set_specs: [1, 2, 3].map((n) => spec({ set_number: n, rpe_min: 7, rpe_max: 8 })),
        },
        [
          makeSetLog({ id: "s1", setNumber: 1, rpe: 8 }),
          makeSetLog({ id: "s2", setNumber: 2, rpe: 9.5 }),
          makeSetLog({ id: "s3", setNumber: 3, rpe: 10 }),
        ],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [inside, oneAbove, twoAbove] = rows();
      expect(measure(inside, "RPE").actual).not.toHaveClass(AMBER);
      expect(measure(oneAbove, "RPE").actual).toHaveClass(AMBER);
      expect(measure(twoAbove, "RPE").actual).toHaveClass(RED);
      expect(measure(twoAbove, "RPE").actual).toHaveClass("font-semibold");
    });

    it("never marks a % load, which can't be compared with kilograms", () => {
      setupExercise(
        {
          name: "Squat",
          sets: 2,
          set_specs: [
            spec({ set_number: 1, reps_min: 10, reps_max: 12, load_type: "pct_1rm", load_min: 60, load_max: 60, rpe_min: 8, rpe_max: 8 }),
            spec({ set_number: 2, reps_min: 10, reps_max: 12, load_type: "pct_top", load_min: 80, load_max: 80 }),
          ],
        },
        [
          makeSetLog({ id: "s1", setNumber: 1, reps: 10, weight: 140, rpe: 8 }),
          makeSetLog({ id: "s2", setNumber: 2, reps: 10, weight: 5 }),
        ],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [first, second] = rows();
      expect(measure(first, "Load (kg)").target).toBe("60% 1RM");
      expect(measure(second, "Load (kg)").target).toBe("80% top set");
      expect(measure(first, "Load (kg)").actual).not.toHaveClass(AMBER);
      expect(measure(second, "Load (kg)").actual).not.toHaveClass(AMBER);
      expect(measure(first, "Reps").target).toBe("10–12");
    });

    it("marks a tempo that differs from the prescribed one", () => {
      setupExercise(
        {
          name: "Squat",
          sets: 2,
          prescribed_fields: ["set_type", "reps", "tempo"],
          set_specs: [1, 2].map((n) => spec({ set_number: n, reps_min: 5, reps_max: 5, tempo: "3-1-X-0" })),
        },
        [
          makeSetLog({ id: "s1", setNumber: 1, reps: 5, weight: null, tempo: "3-1-X-0" }),
          makeSetLog({ id: "s2", setNumber: 2, reps: 5, weight: null, tempo: "2-0-X-0" }),
        ],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [same, differs] = rows();
      expect(measure(same, "Tempo")).toMatchObject({ target: "3-1-X-0" });
      expect(measure(same, "Tempo").actual).not.toHaveClass(AMBER);
      expect(measure(differs, "Tempo").actual).toHaveClass(AMBER);
      expect(measure(differs, "Tempo").actual).toHaveTextContent("2-0-X-0, differs from target");
    });

    it("mutes a warm-up and never marks it, whatever it records", () => {
      setupExercise(
        {
          name: "Bench Press",
          sets: 2,
          set_specs: [
            spec({ set_number: 1, set_type: "warmup", reps_min: 15, reps_max: 15, load_type: "absolute", load_min: 20, load_max: 20 }),
            spec({ set_number: 2, reps_min: 8, reps_max: 12 }),
          ],
        },
        [makeSetLog({ setNumber: 1, reps: 10, weight: 30 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [warmupRow] = rows();
      expect(within(warmupRow).getByText("Warm-up")).toBeInTheDocument();
      expect(within(warmupRow).getByText("Logged")).toBeInTheDocument();
      // Recorded but never scored: muted rather than primary ink, and not amber
      // though both values are outside the warm-up's target.
      expect(measure(warmupRow, "Load (kg)").actual).toHaveClass("text-[#93b0b4]");
      expect(measure(warmupRow, "Load (kg)").actual).not.toHaveClass(AMBER);
      expect(measure(warmupRow, "Reps").actual).toHaveTextContent(/^10$/);
    });

    it("shows no rep target for an AMRAP row, only its load and RPE", () => {
      setupExercise(
        {
          name: "Bench Press",
          sets: 2,
          set_specs: [
            spec({ set_number: 1, reps_min: 8, reps_max: 12 }),
            // A stale range the editor left behind when the coach switched
            // this set to AMRAP. It must not reach the coach as though it
            // were prescribed.
            spec({
              set_number: 2,
              set_type: "amrap",
              reps_min: 7,
              reps_max: 11,
              load_type: "pct_1rm",
              load_min: 60, load_max: 60,
              rpe_min: 9, rpe_max: 9,
            }),
          ],
        },
        [makeSetLog({ id: "s2", setNumber: 2, reps: 14, weight: 60, rpe: 9 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [working, amrap] = rows();
      expect(measure(working, "Reps").target).toBe("8–12");
      expect(measure(amrap, "Reps").target).toBe("");
      expect(measure(amrap, "Reps").actual).not.toHaveClass(AMBER);
      expect(measure(amrap, "Load (kg)").target).toBe("60% 1RM");
      expect(measure(amrap, "RPE").target).toBe("9");
      expect(screen.queryByText(/7–11|7-11/)).not.toBeInTheDocument();
    });

    it("tags non-working set types and leaves working sets untagged", () => {
      setupExercise(
        {
          name: "Bench Press",
          sets: 4,
          set_specs: [
            spec({ set_number: 1, set_type: "warmup" }),
            spec({ set_number: 2 }),
            spec({ set_number: 3, set_type: "amrap" }),
            spec({ set_number: 4, set_type: "failure" }),
          ],
        },
        [],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(screen.getByText("Warm-up")).toBeInTheDocument();
      expect(screen.getByText("AMRAP")).toBeInTheDocument();
      expect(screen.getByText("Failure")).toBeInTheDocument();
      // The working set carries no tag — it is the default.
      const [, working] = rows();
      expect(within(working).queryByText(/warm-up|failure|drop|amrap/i)).toBeNull();
    });

    it("flattens a drop set into its sibling rows", () => {
      setupExercise(
        {
          name: "Lat Pulldown",
          sets: 2,
          set_specs: [
            spec({ set_number: 1, reps_min: 10, reps_max: 10, load_type: "absolute", load_min: 80, load_max: 80 }),
            spec({
              set_number: 2,
              set_type: "drop",
              reps_min: 10,
              reps_max: 10,
              load_type: "absolute",
              load_min: 80, load_max: 80,
              drops: [
                { weight: 60, reps: 8 },
                { weight: 40, reps: 6 },
              ],
            }),
          ],
        },
        // The wire numbers the FLATTENED list, so the second drop is set 4.
        [makeSetLog({ setNumber: 4, reps: 6, weight: 40 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      // 1 working + drop top + 2 drops.
      expect(rows()).toHaveLength(4);
      expect(screen.getAllByText("Drop")).toHaveLength(3);
      const [, dropTop, firstDrop, lastDrop] = rows();
      expect(within(lastDrop).getByText("Logged")).toBeInTheDocument();
      expect(measure(lastDrop, "Load (kg)").target).toBe("40 kg");
      expect(measure(lastDrop, "Reps").target).toBe("6");

      // buildSetDisplayNumbers returns the PARENT's number for a drop
      // continuation and leaves blanking to each renderer, so the extraction
      // does NOT guarantee this: the top set keeps its number, the two
      // continuation rows show none, or they read as duplicate set 2s.
      const setNumber = (row: HTMLElement) => within(row).getByTestId("logged-set-number");
      expect(setNumber(dropTop)).toHaveTextContent("2");
      expect(setNumber(firstDrop).textContent).toBe("Drop");
      expect(setNumber(lastDrop).textContent).toBe("Drop");
    });
  });

  describe("the columns follow the exercise, and the data", () => {
    it("gives a run its own columns: Set, Distance, Duration, Pace", () => {
      setupExercise(
        {
          name: "Running",
          sets: 1,
          prescribed_fields: ["set_type", "distance", "duration", "pace", "rest"],
          set_specs: [
            spec({
              set_number: 1,
              distance_meters_min: 5000, distance_meters_max: 5000,
              duration_seconds_min: 1500, duration_seconds_max: 1620,
              pace_seconds_per_km_min: 300, pace_seconds_per_km_max: 320,
              rest_seconds: 60,
            }),
          ],
        },
        [makeSetLog({ setNumber: 1, reps: null, weight: null, distanceMeters: 5020, durationSeconds: 1570, paceSecondsPerKm: 313 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
      expect(headers).toEqual(["Set", "Distance", "Duration", "Pace"]);
      const [set] = rows();
      expect(measure(set, "Distance")).toMatchObject({ target: "5 km" });
      expect(measure(set, "Distance").actual).toHaveTextContent("5.02 km, above target");
      expect(measure(set, "Duration").target).toBe("25:00–27:00");
      expect(measure(set, "Duration").actual).toHaveTextContent(/^26:10$/);
      expect(measure(set, "Pace").target).toBe("5:00–5:20 /km");
      expect(measure(set, "Pace").actual).toHaveTextContent(/^5:13 \/km$/);
    });

    it("shows a column a set recorded a value in, though the coach didn't prescribe it", () => {
      setupExercise(
        {
          name: "Push Up",
          sets: 1,
          prescribed_fields: ["set_type", "reps", "rest"],
          set_specs: [spec({ set_number: 1, reps_min: 15, reps_max: 15 })],
        },
        [makeSetLog({ setNumber: 1, reps: 15, weight: null, rir: 2 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
      expect(headers).toEqual(["Set", "Reps", "RIR"]);
      const [set] = rows();
      expect(measure(set, "RIR")).toMatchObject({ target: "" });
      expect(measure(set, "RIR").actual).toHaveTextContent(/^2$/);
    });

    it("reads an old snapshot with no column list as today's five", () => {
      setupExercise(
        { name: "Bench Press", sets: 1, reps_min: 8, reps_max: 12 },
        [makeSetLog({ setNumber: 1, reps: 10, weight: 60 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
      expect(headers).toEqual(["Set", "Load (kg)", "Reps", "RPE"]);
    });

    it("shows Rest only when a rest was recorded, the rest taken under the rest prescribed", () => {
      const snapshot = {
        name: "Squat",
        sets: 2,
        set_specs: [1, 2].map((n) => spec({ set_number: n, reps_min: 5, reps_max: 5, rest_seconds: 120 })),
      };
      setupExercise(snapshot, [makeSetLog({ setNumber: 1, reps: 5 })]);
      const { unmount } = render(<SessionLogDetailDialog {...defaultProps} />);
      expect(screen.queryByRole("columnheader", { name: "Rest" })).toBeNull();
      unmount();

      setupExercise(snapshot, [
        makeSetLog({ id: "s1", setNumber: 1, reps: 5, restSeconds: 120 }),
        makeSetLog({ id: "s2", setNumber: 2, reps: 5, restSeconds: 150 }),
      ]);
      render(<SessionLogDetailDialog {...defaultProps} />);

      const [onTime, long] = rows();
      expect(measure(onTime, "Rest")).toMatchObject({ target: "2m" });
      expect(measure(onTime, "Rest").actual).not.toHaveClass(AMBER);
      expect(measure(long, "Rest").actual).toHaveClass(AMBER);
      expect(measure(long, "Rest").actual).toHaveTextContent("2m 30s, above target");
    });

    it("reads loads in an imperial viewer's pounds, snapped, the header naming the unit", () => {
      units.preference = "imperial";
      setupExercise(
        {
          name: "Squat",
          sets: 1,
          set_specs: [spec({ set_number: 1, load_type: "absolute", load_min: 100, load_max: 100 })],
        },
        // What an imperial client's "220 lbs" hint asks for: 99.79 kg.
        [makeSetLog({ setNumber: 1, reps: 5, weight: 99.79 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [set] = rows();
      expect(measure(set, "Load (lbs)")).toMatchObject({ target: "220 lbs" });
      // Two numbers that read the same are never outside each other.
      expect(measure(set, "Load (lbs)").actual).toHaveTextContent(/^220$/);
      expect(measure(set, "Load (lbs)").actual).not.toHaveClass(AMBER);
    });
  });

  describe("the frame", () => {
    it("keeps the Set column in place while the measures scroll sideways inside the card", () => {
      setupExercise(
        {
          name: "Stationary Bike",
          sets: 1,
          prescribed_fields: [
            "set_type", "distance", "duration", "calories", "cadence", "resistance",
            "heart_rate", "power", "ftp_percent", "rest",
          ],
          set_specs: [spec({ set_number: 1 })],
        },
        [makeSetLog({ setNumber: 1, reps: null, weight: null, power: 250 })],
      );

      render(<SessionLogDetailDialog {...defaultProps} />);

      const [set] = rows();
      // The Table primitive's own container is what scrolls, inside the card.
      expect(set.closest("[data-slot='table-container']")).toHaveClass("overflow-x-auto");
      expect(within(set).getAllByRole("cell")[0]).toHaveClass("sticky", "left-0", "bg-white");
      expect(screen.getByRole("columnheader", { name: "Set" })).toHaveClass("sticky", "left-0");
      expect(screen.getAllByRole("columnheader")).toHaveLength(9);
    });

    it("is the tray's 780px, and only its body scrolls", () => {
      setupSWR({ exerciseLogs: [makeExerciseLog()] });

      render(<SessionLogDetailDialog {...defaultProps} />);

      const content = screen.getByRole("dialog");
      expect(content).toHaveClass("sm:max-w-[780px]", "max-h-[85vh]", "grid-rows-[auto_minmax(0,1fr)]");
      // Never on the DialogContent itself, which would scroll its padding and
      // title away with the body.
      expect(content).not.toHaveClass("overflow-y-auto");
      const body = rows()[0].closest(".overflow-y-auto");
      expect(body).toHaveClass("min-h-0");
      expect(content).toContainElement(body as HTMLElement);
      expect(body).not.toContainElement(screen.getByText("Push Day"));
    });
  });

  describe("untouched exercises", () => {
    it("renders a prescribed exercise the client never touched", () => {
      setupSWR({
        exerciseLogs: [makeExerciseLog({ trainingExerciseId: "te-1" })],
        prescribedGroups: [
          makeGroup("grp-1", 0, [makePrescribed({ trainingExerciseId: "te-1" })]),
          makeGroup("grp-2", 1, [
            makePrescribed({
              trainingExerciseId: "te-2",
              name: "Lat Raise",
              snapshot: {
                name: "Lat Raise",
                sets: 3,
                set_specs: [
                  spec({ set_number: 1, reps_min: 12, reps_max: 15 }),
                  spec({ set_number: 2, reps_min: 12, reps_max: 15 }),
                  spec({ set_number: 3, reps_min: 12, reps_max: 15 }),
                ],
              },
            }),
          ]),
        ],
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(screen.getByText("Lat Raise")).toBeInTheDocument();
      // Every one of its rows is not done — it never reached exercise_logs —
      // and each still states its target.
      expect(screen.getAllByText("12–15")).toHaveLength(3);
      expect(screen.getAllByText("Not done")).toHaveLength(4);
    });

    it("orders exercises by the prescription, then anything logged outside it", () => {
      setupSWR({
        exerciseLogs: [
          makeExerciseLog({
            id: "el-extra",
            trainingExerciseId: null,
            performedName: "Unplanned Curl",
            prescribedExerciseSnapshot: null,
            sets: [makeSetLog({ setNumber: 1, reps: 12, weight: 15 })],
          }),
          makeExerciseLog({
            id: "el-1",
            trainingExerciseId: "te-2",
            prescribedExerciseSnapshot: { name: "Row", sets: 1 },
          }),
        ],
        prescribedGroups: [
          makeGroup("grp-1", 0, [
            makePrescribed({ trainingExerciseId: "te-1", name: "Bench Press" }),
          ]),
          makeGroup("grp-2", 1, [makePrescribed({ trainingExerciseId: "te-2", name: "Row" })]),
        ],
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      // Bench Press was prescribed and never touched, Row was logged, and the
      // unplanned add trails both — the order the client worked through them,
      // NOT the order the logs happen to arrive in.
      const names = screen
        .getAllByRole("button")
        .map((b) => b.textContent)
        .filter((t) => t && t !== "Close");
      expect(names).toEqual(["Bench Press", "Row", "Unplanned Curl"]);
    });
  });

  describe("groups", () => {
    const threeRounds = [
      spec({ set_number: 1, reps_min: 10, reps_max: 10 }),
      spec({ set_number: 2, reps_min: 10, reps_max: 10 }),
      spec({ set_number: 3, reps_min: 10, reps_max: 10 }),
    ];
    const prescribed = (id: string, name: string) =>
      makePrescribed({
        trainingExerciseId: id,
        name,
        snapshot: { name, sets: 3, set_specs: threeRounds },
      });

    function setupSuperset(extraLogs: ExerciseLog[] = []) {
      setupSWR({
        exerciseLogs: [
          makeExerciseLog({
            id: "el-row",
            trainingExerciseId: "te-row",
            prescribedExerciseSnapshot: { name: "Pendlay Row", sets: 3, set_specs: threeRounds },
            sets: [makeSetLog({ setNumber: 2, reps: 10, weight: 50 })],
          }),
          ...extraLogs,
        ],
        prescribedGroups: [
          makeGroup("grp-squat", 0, [prescribed("te-squat", "Back Squat")]),
          makeGroup(
            "grp-superset",
            1,
            [prescribed("te-bench", "Bench Press"), prescribed("te-row", "Pendlay Row")],
            {
              format: "circuit",
              rounds: 3,
              restBetweenExercisesSeconds: 30,
              restBetweenRoundsSeconds: 90,
              notes: "Back to back",
            },
          ),
        ],
      });
    }

    it("sits a linked group under a slim heading with its name, rounds, rests and notes", () => {
      setupSuperset();

      render(<SessionLogDetailDialog {...defaultProps} />);

      const superset = screen.getByRole("region", { name: "Superset · 3 rounds" });
      expect(within(superset).getByText("Superset")).toBeInTheDocument();
      // The separators are spaced by margin, as in the dialog's header line.
      expect(superset).toHaveTextContent("30s rest between exercises");
      expect(superset).toHaveTextContent("1m 30s rest between rounds");
      expect(within(superset).getByText("Back to back")).toBeInTheDocument();
      expect(
        within(superset)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(["Bench Press", "Pendlay Row"]);
      // Its rows are rounds, and a logged round sits on its own row.
      expect(within(superset).getAllByText("Round")).toHaveLength(2);
      const rowRows = within(superset).getAllByTestId("logged-set-row").slice(3);
      expect(within(rowRows[1]).getByText("Logged")).toBeInTheDocument();
      expect(within(rowRows[0]).getByText("Not done")).toBeInTheDocument();
    });

    it("gives a lone exercise no heading, no letter and its Set column", () => {
      setupSuperset();

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(screen.getAllByRole("region")).toHaveLength(1);
      const squat = screen.getByRole("button", { name: "Back Squat" });
      expect(squat.closest("section")).toBeNull();
      expect(screen.getAllByText("Set")).toHaveLength(1);
    });

    it("keeps exercises logged outside the prescription after the groups, in none of them", () => {
      setupSuperset([
        makeExerciseLog({
          id: "el-extra",
          trainingExerciseId: null,
          performedName: "Unplanned Curl",
          prescribedExerciseSnapshot: null,
          sets: [makeSetLog({ setNumber: 1, reps: 12, weight: 15 })],
        }),
      ]);

      render(<SessionLogDetailDialog {...defaultProps} />);

      const names = screen
        .getAllByRole("button")
        .map((b) => b.textContent)
        .filter((t) => t && t !== "Close");
      expect(names).toEqual(["Back Squat", "Bench Press", "Pendlay Row", "Unplanned Curl"]);
      expect(screen.getByRole("button", { name: "Unplanned Curl" }).closest("section")).toBeNull();
    });
  });

  describe("exercise identity", () => {
    it("renders a swapped exercise with both names", () => {
      setupSWR({
        exerciseLogs: [
          makeExerciseLog({
            performedName: "Dumbbell Bench",
            prescribedExerciseSnapshot: { name: "Barbell Bench Press", sets: 1 },
          }),
        ],
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(screen.getByText("Dumbbell Bench")).toBeInTheDocument();
      expect(
        screen.getByText(/Prescribed Barbell Bench Press · Performed Dumbbell Bench/),
      ).toBeInTheDocument();
    });

    it("falls back to the snapshot name when the live exercise is gone", () => {
      setupSWR({
        exerciseLogs: [
          makeExerciseLog({
            trainingExerciseId: null,
            performedName: null,
            prescribedExerciseSnapshot: { name: "Deadlift", sets: 1 },
          }),
        ],
      });

      render(<SessionLogDetailDialog {...defaultProps} />);

      expect(screen.getByText("Deadlift")).toBeInTheDocument();
    });

    it("calls onExerciseDrillDown with the exercise id and name", async () => {
      const user = userEvent.setup();
      const onDrillDown = vi.fn();

      setupSWR({
        exerciseLogs: [
          makeExerciseLog({
            exerciseId: "ex-1",
            performedName: null,
            prescribedExerciseSnapshot: { name: "Bench Press", sets: 1 },
          }),
        ],
      });

      render(
        <SessionLogDetailDialog {...defaultProps} onExerciseDrillDown={onDrillDown} />,
      );

      await user.click(screen.getByText("Bench Press"));

      expect(onDrillDown).toHaveBeenCalledWith("ex-1", "Bench Press");
    });

    it("calls onExerciseDrillDown with a null id for a free-form entry", async () => {
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
        <SessionLogDetailDialog {...defaultProps} onExerciseDrillDown={onDrillDown} />,
      );

      await user.click(screen.getByText("Custom Exercise"));

      expect(onDrillDown).toHaveBeenCalledWith(null, "Custom Exercise");
    });
  });
});
