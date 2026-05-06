import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrainingEventDetail } from "@/types/training";
import { SetTracker } from "./set-tracker";

// jsdom doesn't implement ResizeObserver; Radix UI primitives need it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
// Same for PointerEvent — Radix Switch relies on it.
if (!(globalThis as { PointerEvent?: unknown }).PointerEvent) {
  (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent =
    MouseEvent as unknown as typeof PointerEvent;
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const mockEvent = vi.fn();
const mockMe = vi.fn();
vi.mock("swr", () => ({
  default: (key: string | null) => {
    if (key === null)
      return { data: undefined, error: undefined, isLoading: false };
    if (typeof key === "string" && key.startsWith("/api/client/training/events/"))
      return mockEvent();
    if (key === "/api/client/me") return mockMe();
    throw new Error(`Unmocked SWR key: ${String(key)}`);
  },
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const ISO = "2026-05-01T00:00:00.000Z";
const REAL_UUID_A = "11111111-1111-4111-8111-111111111111";
const REAL_UUID_B = "22222222-2222-4222-8222-222222222222";

function baseFixture(): TrainingEventDetail {
  return {
    event: {
      id: "evt-1",
      clientId: "c-1",
      trainingPlanId: "p-1",
      trainingSessionId: "s-1",
      date: "2026-05-06",
      sessionName: "Push Day A",
      sessionFocus: "Chest + triceps",
      estimatedCalories: null,
      status: "scheduled",
      sessionLogId: null,
      isModified: false,
      calorieSurplusPercentage: null,
      createdAt: ISO,
      updatedAt: ISO,
    },
    session: {
      source: "live",
      session: {
        id: "s-1",
        planId: "p-1",
        name: "Push Day A",
        orderIndex: 0,
        focus: "Chest + triceps",
        estimatedDurationMinutes: 45,
        calorieSurplusPercentage: null,
        exercises: [],
        createdAt: ISO,
        updatedAt: ISO,
      },
    },
    exercises: [
      {
        source: "live",
        exercise: {
          id: REAL_UUID_A,
          sessionId: "s-1",
          exerciseId: null,
          name: "Bench Press",
          orderIndex: 0,
          sets: 3,
          repsTarget: "8-12",
          rpeTarget: 8,
          isWarmup: false,
          createdAt: ISO,
          updatedAt: ISO,
        },
      },
      {
        source: "live",
        exercise: {
          id: REAL_UUID_B,
          sessionId: "s-1",
          exerciseId: null,
          name: "Overhead Press",
          orderIndex: 1,
          sets: 4,
          repsTarget: "6-10",
          isWarmup: false,
          createdAt: ISO,
          updatedAt: ISO,
        },
      },
    ],
    sessionLog: null,
    exerciseLogs: [],
  };
}

function setEventReady(detail: TrainingEventDetail = baseFixture()) {
  mockEvent.mockReturnValue({
    data: { success: true, data: detail },
    error: undefined,
    isLoading: false,
  });
}

function setMe(weightUnit: "lbs" | "kg" = "lbs") {
  mockMe.mockReturnValue({
    data: { success: true, data: { weightUnit } },
    error: undefined,
    isLoading: false,
  });
}

function getLastFetchPayload(): unknown {
  const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
    .calls;
  if (calls.length === 0) throw new Error("fetch was not called");
  const last = calls[calls.length - 1];
  const body = (last[1] as RequestInit | undefined)?.body;
  if (typeof body !== "string") throw new Error("fetch body was not a string");
  return JSON.parse(body);
}

describe("SetTracker", () => {
  beforeEach(() => {
    mockEvent.mockReset();
    mockMe.mockReset();
    mockToast.mockReset();
    setMe("lbs");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { sessionLogId: "log-1" } }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- existing baseline tests (extended) ---------------------------------

  it("shows skeleton while loading", () => {
    mockEvent.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    });
    setMe();
    render(<SetTracker eventId="evt-1" />);
    expect(screen.getByTestId("set-tracker-skeleton")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", () => {
    mockEvent.mockReturnValue({
      data: undefined,
      error: new Error("boom"),
      isLoading: false,
    });
    setMe();
    render(<SetTracker eventId="evt-1" />);
    expect(screen.getByText(/failed to load workout/i)).toBeInTheDocument();
  });

  it("renders header and quick-log controls on happy path", () => {
    setEventReady();
    render(<SetTracker eventId="evt-1" date="2026-05-06" />);
    expect(screen.getByText("Push Day A")).toBeInTheDocument();
    expect(screen.getByText("Chest + triceps")).toBeInTheDocument();
    expect(screen.getByTestId("quick-log-full")).toBeInTheDocument();
    expect(screen.getByTestId("detailed-toggle")).toBeInTheDocument();
  });

  // ---- 1. Quick log full ---------------------------------------------------

  it("[quick-full] submits { completionQuality: 'full' } with no exercises", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(getLastFetchPayload()).toEqual({ completionQuality: "full" });
  });

  // ---- 2. Quick log partial ------------------------------------------------

  it("[quick-partial] submits { completionQuality: 'partial' }", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("quick-log-partial"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(getLastFetchPayload()).toEqual({ completionQuality: "partial" });
  });

  // ---- 3. Quick log skipped ------------------------------------------------

  it("[quick-skipped] submits { completionQuality: 'skipped' }", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("quick-log-skipped"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(getLastFetchPayload()).toEqual({ completionQuality: "skipped" });
  });

  // ---- 4. Quick log with notes --------------------------------------------

  it("[quick-notes] notes are included in payload", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("session-notes-toggle"));
    await user.type(screen.getByTestId("session-notes"), "Felt strong today");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(getLastFetchPayload()).toEqual({
      completionQuality: "full",
      notes: "Felt strong today",
    });
  });

  // ---- 5. Detailed path ---------------------------------------------------

  it("[detailed] expanding + filling sets submits exercises[] matching schema", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    const ex0 = screen.getAllByTestId("exercise-tracker-block")[0];
    await user.type(within(ex0).getByLabelText("Set 1 reps"), "10");
    await user.type(within(ex0).getByLabelText("Set 1 weight"), "100");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      completionQuality: string;
      exercises?: Array<{
        trainingExerciseId?: string;
        exerciseName: string;
        sets: Array<{ reps?: number; weight?: number; rpe?: number }>;
        weightUnit: string;
      }>;
    };
    expect(payload.completionQuality).toBe("full");
    expect(payload.exercises).toHaveLength(1);
    expect(payload.exercises![0]).toMatchObject({
      trainingExerciseId: REAL_UUID_A,
      exerciseName: "Bench Press",
      weightUnit: "lbs",
      sets: [{ reps: 10, weight: 100 }],
    });
  });

  // ---- 6. Detailed skip exercise ------------------------------------------

  it("[detailed-skip] skip toggle produces { skipped: true, sets: [] }", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    await user.click(screen.getByTestId("skip-toggle-0"));
    await user.click(screen.getByTestId("quick-log-partial"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      completionQuality: string;
      exercises?: Array<{ skipped?: boolean; sets: unknown[] }>;
    };
    expect(payload.completionQuality).toBe("partial");
    expect(payload.exercises).toHaveLength(1);
    expect(payload.exercises![0].skipped).toBe(true);
    expect(payload.exercises![0].sets).toEqual([]);
  });

  // ---- 7. Save disabled until status selected -----------------------------

  it("[disabled-no-status] save button disabled until status selected", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    expect(screen.getByTestId("save-button")).toBeDisabled();
    await user.click(screen.getByTestId("quick-log-full"));
    expect(screen.getByTestId("save-button")).not.toBeDisabled();
  });

  // ---- 8. Save disabled during flight + Loader2 ---------------------------

  it("[in-flight] save button disabled and Loader2 shown during fetch", async () => {
    setEventReady();
    let resolveFetch!: (value: unknown) => void;
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolveFetch = r;
        }),
    ) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() =>
      expect(screen.getByTestId("save-button")).toBeDisabled(),
    );
    const btn = screen.getByTestId("save-button");
    expect(btn.querySelector("svg.animate-spin")).not.toBeNull();
    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
  });

  // ---- 9. Error toast on failure ------------------------------------------

  it("[error-toast] destructive toast shown when fetch !ok", async () => {
    setEventReady();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "server boom" }),
    }) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    const lastCall = mockToast.mock.calls[mockToast.mock.calls.length - 1][0];
    expect(lastCall.variant).toBe("destructive");
    expect(String(lastCall.description)).toContain("server boom");
  });

  // ---- 10. Copy previous set ----------------------------------------------

  it("[copy-previous] copies reps/weight from prior filled row", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    const ex0 = screen.getAllByTestId("exercise-tracker-block")[0];
    await user.type(within(ex0).getByLabelText("Set 1 reps"), "10");
    await user.type(within(ex0).getByLabelText("Set 1 weight"), "100");
    await user.click(screen.getByTestId("copy-previous-0-1"));
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 2 reps").value,
    ).toBe("10");
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 2 weight").value,
    ).toBe("100");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      exercises?: Array<{ sets: Array<{ reps?: number; weight?: number }> }>;
    };
    expect(payload.exercises![0].sets).toHaveLength(2);
    expect(payload.exercises![0].sets[0]).toMatchObject({ reps: 10, weight: 100 });
    expect(payload.exercises![0].sets[1]).toMatchObject({ reps: 10, weight: 100 });
  });

  // ---- 11. Weight unit label ----------------------------------------------

  it("[weight-unit] label reflects client preference", async () => {
    setEventReady();
    setMe("kg");
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    const blocks = screen.getAllByTestId("exercise-tracker-block");
    expect(within(blocks[0]).getAllByText(/kg/i).length).toBeGreaterThan(0);
  });

  // ---- 12. Collapse persists data -----------------------------------------

  it("[collapse-persists] data persists across collapse/expand cycles", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    const ex0 = screen.getAllByTestId("exercise-tracker-block")[0];
    await user.type(within(ex0).getByLabelText("Set 1 reps"), "8");
    await user.type(within(ex0).getByLabelText("Set 1 weight"), "135");
    await user.click(screen.getByTestId("detailed-toggle")); // collapse
    await user.click(screen.getByTestId("quick-log-partial"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      exercises?: Array<{ sets: Array<{ reps?: number; weight?: number }> }>;
    };
    expect(payload.exercises).toHaveLength(1);
    expect(payload.exercises![0].sets[0]).toMatchObject({
      reps: 8,
      weight: 135,
    });
  });

  // ---- 13. Notes in both modes --------------------------------------------

  it("[notes-both-modes] top-level notes included in detailed payload", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("session-notes-toggle"));
    await user.type(screen.getByTestId("session-notes"), "Tough session");
    await user.click(screen.getByTestId("detailed-toggle"));
    const ex0 = screen.getAllByTestId("exercise-tracker-block")[0];
    await user.type(within(ex0).getByLabelText("Set 1 reps"), "8");
    await user.type(within(ex0).getByLabelText("Set 1 weight"), "100");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      notes?: string;
      exercises?: unknown;
    };
    expect(payload.notes).toBe("Tough session");
    expect(payload.exercises).toBeDefined();
  });

  // ---- 14. trainingExerciseId UUID filter ---------------------------------

  it("[uuid-filter] non-UUID prescribed id is omitted from payload", async () => {
    const detail = baseFixture();
    // Change exercise to snapshot with no id, so set-tracker synthesizes "snapshot-0"
    detail.exercises = [
      {
        source: "snapshot",
        snapshot: {
          name: "Mystery Exercise",
          sets: 2,
          isWarmup: false,
        },
      },
    ];
    setEventReady(detail);
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    await user.type(screen.getByLabelText("Set 1 reps"), "10");
    await user.type(screen.getByLabelText("Set 1 weight"), "100");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      exercises?: Array<{
        trainingExerciseId?: string;
        exerciseName: string;
      }>;
    };
    expect(payload.exercises).toHaveLength(1);
    expect(payload.exercises![0]).not.toHaveProperty("trainingExerciseId");
    expect(payload.exercises![0].exerciseName).toBe("Mystery Exercise");
  });

  // ---- 15. Per-exercise notes alone do not trigger detailed payload -------

  it("[notes-only-no-detail] per-exercise notes alone do not include exercise in payload", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    await user.click(screen.getByTestId("exercise-notes-toggle-0"));
    await user.type(
      screen.getByTestId("exercise-notes-0"),
      "Felt easy, no soreness",
    );
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as { exercises?: unknown };
    expect(payload).toEqual({ completionQuality: "full" });
    expect(payload.exercises).toBeUndefined();
  });

  // ---- 17. Add set --------------------------------------------------------

  it("[add-set] add-set button appends a new set row", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    const ex0 = screen.getAllByTestId("exercise-tracker-block")[0];
    // Bench Press is prescribed with sets: 3 → starts with 3 rows.
    expect(within(ex0).getAllByTestId("set-row")).toHaveLength(3);
    await user.click(within(ex0).getByTestId("add-set-0"));
    expect(within(ex0).getAllByTestId("set-row")).toHaveLength(4);
    // The new row is editable and submittable.
    await user.type(within(ex0).getByLabelText("Set 4 reps"), "12");
    await user.type(within(ex0).getByLabelText("Set 4 weight"), "95");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      exercises?: Array<{ sets: Array<{ reps?: number; weight?: number }> }>;
    };
    expect(payload.exercises![0].sets).toEqual([
      { reps: 12, weight: 95 },
    ]);
  });

  // ---- 17b. Delete set ----------------------------------------------------

  it("[delete-set] delete-set button removes a row and excludes its data from payload", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    const ex0 = screen.getAllByTestId("exercise-tracker-block")[0];
    expect(within(ex0).getAllByTestId("set-row")).toHaveLength(3);
    await user.type(within(ex0).getByLabelText("Set 1 reps"), "10");
    await user.type(within(ex0).getByLabelText("Set 1 weight"), "100");
    await user.type(within(ex0).getByLabelText("Set 2 reps"), "9");
    await user.type(within(ex0).getByLabelText("Set 2 weight"), "100");
    // Delete row 2 (the second filled row).
    await user.click(within(ex0).getByTestId("delete-set-0-1"));
    expect(within(ex0).getAllByTestId("set-row")).toHaveLength(2);
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      exercises?: Array<{ sets: Array<{ reps?: number; weight?: number }> }>;
    };
    expect(payload.exercises).toHaveLength(1);
    expect(payload.exercises![0].sets).toEqual([{ reps: 10, weight: 100 }]);
  });

  // ---- 18. Collapsible session notes --------------------------------------

  it("[notes-collapsed] session notes hidden by default; toggle reveals textarea", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    expect(screen.queryByTestId("session-notes")).toBeNull();
    expect(screen.getByTestId("session-notes-toggle")).toBeInTheDocument();
    await user.click(screen.getByTestId("session-notes-toggle"));
    expect(screen.getByTestId("session-notes")).toBeInTheDocument();
  });

  it("[notes-auto-expand] session notes auto-expand when pre-populated from log", () => {
    const detail = baseFixture();
    detail.sessionLog = {
      id: "log-1",
      clientId: "c-1",
      trainingSessionId: "s-1",
      completedAt: "2026-05-06",
      completionQuality: "full",
      notes: "Pre-existing notes",
      weekStartDate: "2026-05-04",
      prescribedSessionSnapshot: null,
      createdAt: ISO,
      updatedAt: ISO,
    };
    setEventReady(detail);
    render(<SetTracker eventId="evt-1" />);
    expect(screen.queryByTestId("session-notes-toggle")).toBeNull();
    expect(
      screen.getByTestId<HTMLTextAreaElement>("session-notes").value,
    ).toBe("Pre-existing notes");
  });

  // ---- 19. Pre-populated from existing log --------------------------------

  it("[restore] pre-populates form from existing sessionLog + exerciseLogs", async () => {
    const detail = baseFixture();
    detail.sessionLog = {
      id: "log-1",
      clientId: "c-1",
      trainingSessionId: "s-1",
      completedAt: "2026-05-06",
      completionQuality: "partial",
      notes: "Felt good",
      weekStartDate: "2026-05-04",
      prescribedSessionSnapshot: null,
      createdAt: ISO,
      updatedAt: ISO,
    };
    detail.exerciseLogs = [
      {
        id: "elog-1",
        sessionLogId: "log-1",
        trainingExerciseId: REAL_UUID_A,
        completed: true,
        actualSets: 3,
        actualReps: "10,10,8",
        actualWeight: 105,
        weightUnit: "lbs",
        notes: null,
        prescribedExerciseSnapshot: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ];
    setEventReady(detail);
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    // Status pre-selected
    expect(screen.getByTestId("quick-log-partial")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Notes pre-filled
    expect(
      screen.getByTestId<HTMLTextAreaElement>("session-notes").value,
    ).toBe("Felt good");
    // Set rows pre-populated
    await user.click(screen.getByTestId("detailed-toggle"));
    const ex0 = screen.getAllByTestId("exercise-tracker-block")[0];
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 1 reps").value,
    ).toBe("10");
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 2 reps").value,
    ).toBe("10");
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 3 reps").value,
    ).toBe("8");
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 1 weight").value,
    ).toBe("105");
    // Save without modification → submitted payload includes restored values
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      completionQuality: string;
      notes?: string;
      exercises?: Array<{ sets: Array<{ reps?: number; weight?: number }> }>;
    };
    expect(payload.completionQuality).toBe("partial");
    expect(payload.notes).toBe("Felt good");
    expect(payload.exercises).toHaveLength(1);
    expect(payload.exercises![0].sets).toEqual([
      { reps: 10, weight: 105 },
      { reps: 10, weight: 105 },
      { reps: 8, weight: 105 },
    ]);
  });
});
