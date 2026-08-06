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
const mockSession = vi.fn();
const mockGlobalMutate = vi.fn();
vi.mock("swr", () => ({
  default: (key: string | null) => {
    if (key === null)
      return { data: undefined, error: undefined, isLoading: false };
    if (typeof key === "string" && key.startsWith("/api/client/training/events/"))
      return mockEvent();
    if (typeof key === "string" && key.startsWith("/api/client/training/sessions/"))
      return mockSession();
    if (key === "/api/client/me") return mockMe();
    throw new Error(`Unmocked SWR key: ${String(key)}`);
  },
  mutate: (...args: unknown[]) => mockGlobalMutate(...args),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
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
    mockSession.mockReset();
    mockSession.mockReturnValue({ data: undefined, error: undefined, isLoading: false });
    mockToast.mockReset();
    mockGlobalMutate.mockReset();
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
    // The event detail cache is dropped so re-entering refetches the logged status
    // (a quick-log's only signal is sessionLog.completionQuality).
    await waitFor(() =>
      expect(mockGlobalMutate).toHaveBeenCalledWith(
        "/api/client/training/events/evt-1",
        undefined,
        { revalidate: false },
      ),
    );
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
      // Was "lbs" — the client's display unit, sent for the server to apply. The
      // form converts before sending now, so the wire is always canonical.
      weightUnit: "kg",
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

  // ---- 17c. Delete unplanned exercise -------------------------------------

  it("[delete-exercise] delete button only on unplanned blocks; removes block + excludes data", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    // Prescribed blocks (indices 0 and 1) must NOT have a delete-exercise button.
    expect(screen.queryByTestId("delete-exercise-0")).toBeNull();
    expect(screen.queryByTestId("delete-exercise-1")).toBeNull();
    // Add an unplanned exercise.
    await user.type(
      screen.getByTestId("add-exercise-name"),
      "Calf Raises",
    );
    await user.click(screen.getByTestId("add-exercise-submit"));
    expect(screen.getAllByTestId("exercise-tracker-block")).toHaveLength(3);
    // Fill a set so the unplanned exercise would otherwise be in the payload.
    const ex2 = screen.getAllByTestId("exercise-tracker-block")[2];
    await user.type(within(ex2).getByLabelText("Set 1 reps"), "20");
    await user.type(within(ex2).getByLabelText("Set 1 weight"), "30");
    // Delete the unplanned exercise.
    expect(screen.getByTestId("delete-exercise-2")).toBeInTheDocument();
    await user.click(screen.getByTestId("delete-exercise-2"));
    expect(screen.getAllByTestId("exercise-tracker-block")).toHaveLength(2);
    // Save → no exercises in payload (the only filled exercise was just deleted).
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as { exercises?: unknown };
    expect(payload).toEqual({ completionQuality: "full" });
    expect(payload.exercises).toBeUndefined();
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

  it("[notes-hide] expanded notes can be collapsed; content persists across hide/show and is submitted", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("session-notes-toggle"));
    await user.type(screen.getByTestId("session-notes"), "Persisted text");
    await user.click(screen.getByTestId("session-notes-hide"));
    expect(screen.queryByTestId("session-notes")).toBeNull();
    expect(screen.getByTestId("session-notes-toggle")).toBeInTheDocument();
    await user.click(screen.getByTestId("session-notes-toggle"));
    expect(
      screen.getByTestId<HTMLTextAreaElement>("session-notes").value,
    ).toBe("Persisted text");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(getLastFetchPayload()).toEqual({
      completionQuality: "full",
      notes: "Persisted text",
    });
  });

  it("[notes-auto-expand] session notes auto-expand when pre-populated from log", () => {
    const detail = baseFixture();
    detail.sessionLog = {
      id: "log-1",
      clientId: "c-1",
      trainingSessionId: "s-1",
      trainingEventId: null,
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

  // ---- 17d. Picker integration in Add unplanned --------------------------

  it("[picker-typeahead] picking a result from the dropdown populates name + exerciseId", async () => {
    setEventReady();
    const PICKED_ID = "33333333-3333-4333-8333-333333333333";
    // Override fetch to handle BOTH the search call AND the save POST.
    const realFetch = global.fetch;
    global.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.startsWith("/api/client/exercises")
        ) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                exercises: [
                  {
                    id: PICKED_ID,
                    name: "Bulgarian Split Squat",
                    muscleGroup: "legs",
                  },
                ],
              }),
          });
        }
        return (realFetch as unknown as typeof fetch)(url, init);
      }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    await user.type(
      screen.getByTestId("add-exercise-name"),
      "bulgarian",
    );
    // Wait for the dropdown option to appear and click it.
    await waitFor(() =>
      expect(screen.getByText("Bulgarian Split Squat")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId(`add-exercise-name-option-${PICKED_ID}`));
    await user.click(screen.getByTestId("add-exercise-submit"));
    // Fill a set so the unplanned exercise is included in the payload.
    const blocks = screen.getAllByTestId("exercise-tracker-block");
    const newBlock = blocks[blocks.length - 1];
    await user.type(within(newBlock).getByLabelText("Set 1 reps"), "10");
    await user.type(within(newBlock).getByLabelText("Set 1 weight"), "30");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/client/training/events/"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = (
      global.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find((c) =>
      String(c[0]).includes("/api/client/training/events/"),
    );
    const body = JSON.parse(postCall![1].body as string) as {
      exercises?: Array<{
        exerciseId?: string;
        exerciseName: string;
      }>;
    };
    const unplanned = body.exercises!.find(
      (ex) => ex.exerciseName === "Bulgarian Split Squat",
    );
    expect(unplanned).toBeDefined();
    expect(unplanned!.exerciseId).toBe(PICKED_ID);
  });

  it("[picker-freehand] free-form name (no match) submits exerciseName but no exerciseId", async () => {
    setEventReady();
    const realFetch = global.fetch;
    global.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.startsWith("/api/client/exercises")
        ) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ exercises: [] }),
          });
        }
        return (realFetch as unknown as typeof fetch)(url, init);
      }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    await user.type(
      screen.getByTestId("add-exercise-name"),
      "Made-up Movement",
    );
    await user.click(screen.getByTestId("add-exercise-submit"));
    const blocks = screen.getAllByTestId("exercise-tracker-block");
    const newBlock = blocks[blocks.length - 1];
    await user.type(within(newBlock).getByLabelText("Set 1 reps"), "10");
    await user.type(within(newBlock).getByLabelText("Set 1 weight"), "20");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/client/training/events/"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = (
      global.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find((c) =>
      String(c[0]).includes("/api/client/training/events/"),
    );
    const body = JSON.parse(postCall![1].body as string) as {
      exercises?: Array<{ exerciseId?: string; exerciseName: string }>;
    };
    const made = body.exercises!.find(
      (ex) => ex.exerciseName === "Made-up Movement",
    );
    expect(made).toBeDefined();
    expect(made!.exerciseId).toBeUndefined();
  });

  // ---- 17e. Log workout button location ----------------------------------

  it("[log-button-location] Log workout button sits above the quick-log card and submits the form", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    const saveBtn = screen.getByTestId("save-button");
    expect(saveBtn).toHaveTextContent(/log workout/i);
    // The button is OUTSIDE the QuickLogControls section (no longer inside).
    // The QuickLogControls section is identifiable by quick-log-full living
    // inside it; assert the save button is not a descendant.
    const quickFull = screen.getByTestId("quick-log-full");
    const quickSection = quickFull.closest("section");
    expect(quickSection).not.toBeNull();
    expect(quickSection!.contains(saveBtn)).toBe(false);
    // Submit still works.
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(saveBtn);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(getLastFetchPayload()).toEqual({ completionQuality: "full" });
  });

  // ---- 17f. Swap UI for prescribed exercises -----------------------------

  it("[swap-prescribed] picking a swap target updates the displayed name + payload, preserves training_exercise_id", async () => {
    setEventReady();
    const PICKED_ID = "44444444-4444-4444-8444-444444444444";
    const realFetch = global.fetch;
    global.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.startsWith("/api/client/exercises")
        ) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                exercises: [
                  {
                    id: PICKED_ID,
                    name: "Dumbbell Bench",
                    muscleGroup: "chest",
                  },
                ],
              }),
          });
        }
        return (realFetch as unknown as typeof fetch)(url, init);
      }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    await user.click(screen.getByTestId("swap-0"));
    await user.type(screen.getByTestId("swap-picker-0"), "dumbbell");
    await waitFor(() =>
      expect(screen.getByText("Dumbbell Bench")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId(`swap-picker-0-option-${PICKED_ID}`));
    // Block now shows new name + "swapped from Bench Press" indicator.
    const ex0 = screen.getAllByTestId("exercise-tracker-block")[0];
    expect(within(ex0).getByText("Dumbbell Bench")).toBeInTheDocument();
    expect(within(ex0).getByText(/swapped from Bench Press/i)).toBeInTheDocument();
    // Fill a set + save.
    await user.type(within(ex0).getByLabelText("Set 1 reps"), "10");
    await user.type(within(ex0).getByLabelText("Set 1 weight"), "60");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/client/training/events/"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = (
      global.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find((c) =>
      String(c[0]).includes("/api/client/training/events/"),
    );
    const body = JSON.parse(postCall![1].body as string) as {
      exercises?: Array<{
        trainingExerciseId?: string;
        exerciseId?: string;
        exerciseName: string;
      }>;
    };
    const swapped = body.exercises![0];
    expect(swapped.exerciseName).toBe("Dumbbell Bench");
    expect(swapped.exerciseId).toBe(PICKED_ID);
    // Original prescription link preserved.
    expect(swapped.trainingExerciseId).toBe(REAL_UUID_A);
  });

  it("[swap-reset] Reset reverts to prescribed name and clears exerciseId/isSwapped", async () => {
    setEventReady();
    const PICKED_ID = "55555555-5555-4555-8555-555555555555";
    const realFetch = global.fetch;
    global.fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (
          typeof url === "string" &&
          url.startsWith("/api/client/exercises")
        ) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                exercises: [
                  { id: PICKED_ID, name: "Smith Press", muscleGroup: "chest" },
                ],
              }),
          });
        }
        return (realFetch as unknown as typeof fetch)(url, init);
      }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    await user.click(screen.getByTestId("swap-0"));
    await user.type(screen.getByTestId("swap-picker-0"), "smith");
    await waitFor(() =>
      expect(screen.getByText("Smith Press")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId(`swap-picker-0-option-${PICKED_ID}`));
    // Now reset.
    await user.click(screen.getByTestId("swap-reset-0"));
    const ex0 = screen.getAllByTestId("exercise-tracker-block")[0];
    expect(within(ex0).getByText("Bench Press")).toBeInTheDocument();
    expect(within(ex0).queryByText(/swapped from/i)).toBeNull();
    // Save → payload has prescribed name, no exerciseId.
    await user.type(within(ex0).getByLabelText("Set 1 reps"), "10");
    await user.type(within(ex0).getByLabelText("Set 1 weight"), "100");
    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/client/training/events/"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const postCall = (
      global.fetch as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.find((c) =>
      String(c[0]).includes("/api/client/training/events/"),
    );
    const body = JSON.parse(postCall![1].body as string) as {
      exercises?: Array<{ exerciseName: string; exerciseId?: string }>;
    };
    expect(body.exercises![0].exerciseName).toBe("Bench Press");
    expect(body.exercises![0].exerciseId).toBeUndefined();
  });

  it("[unplanned-no-swap] unplanned blocks do not render the Swap action", async () => {
    setEventReady();
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);
    await user.click(screen.getByTestId("detailed-toggle"));
    await user.type(
      screen.getByTestId("add-exercise-name"),
      "Mystery Move",
    );
    await user.click(screen.getByTestId("add-exercise-submit"));
    // Newly added unplanned block is the last one.
    const blocks = screen.getAllByTestId("exercise-tracker-block");
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const unplannedIdx = blocks.length - 1;
    expect(screen.queryByTestId(`swap-${unplannedIdx}`)).toBeNull();
  });

  // ---- 19. Pre-populated from existing log --------------------------------

  it("[restore] pre-populates form from existing sessionLog + exerciseLogs", async () => {
    const detail = baseFixture();
    // A logged day is editable only when it's "today" (past logged days lock),
    // and this test re-saves — so anchor the event to today.
    detail.event = { ...detail.event, date: new Date().toISOString().slice(0, 10) };
    detail.sessionLog = {
      id: "log-1",
      clientId: "c-1",
      trainingSessionId: "s-1",
      trainingEventId: null,
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
        exerciseId: null,
        completed: true,
        weightUnit: "lbs",
        notes: null,
        performedName: "Bench Press",
        prescribedExerciseSnapshot: { name: "Bench Press" },
        sets: [
          {
            id: "sl-1",
            exerciseLogId: "elog-1",
            setType: "working",
            setNumber: 1,
            reps: 10,
            weight: 100,
            rpe: 8,
            createdAt: ISO,
            updatedAt: ISO,
          },
          {
            id: "sl-2",
            exerciseLogId: "elog-1",
            setType: "working",
            setNumber: 2,
            reps: 10,
            weight: 105,
            rpe: 8,
            createdAt: ISO,
            updatedAt: ISO,
          },
          {
            id: "sl-3",
            exerciseLogId: "elog-1",
            setType: "working",
            setNumber: 3,
            reps: 8,
            weight: 105,
            rpe: 9,
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
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
    // Set rows pre-populated with EXACT per-set values (no more lossy
    // top-set broadcast — weights and RPEs differ per row).
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
    ).toBe("100");
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 2 weight").value,
    ).toBe("105");
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 3 weight").value,
    ).toBe("105");
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 1 RPE").value,
    ).toBe("8");
    expect(
      within(ex0).getByLabelText<HTMLInputElement>("Set 3 RPE").value,
    ).toBe("9");
    // Save without modification → submitted payload includes restored values
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const payload = getLastFetchPayload() as {
      completionQuality: string;
      notes?: string;
      exercises?: Array<{
        sets: Array<{ reps?: number; weight?: number; rpe?: number }>;
      }>;
    };
    expect(payload.completionQuality).toBe("partial");
    expect(payload.notes).toBe("Felt good");
    expect(payload.exercises).toHaveLength(1);
    expect(payload.exercises![0].sets).toEqual([
      { reps: 10, weight: 100, rpe: 8 },
      { reps: 10, weight: 105, rpe: 8 },
      { reps: 8, weight: 105, rpe: 9 },
    ]);
  });

  it("[swap-edit] re-entering a logged swap loads the PERFORMED session and saves with its id", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const detail = baseFixture(); // prescribed session s-1
    detail.event = { ...detail.event, date: today };
    detail.sessionLog = {
      id: "log-1",
      clientId: "c-1",
      trainingSessionId: "s-2", // performed a DIFFERENT session (swap)
      trainingEventId: "evt-1",
      completedAt: today,
      completionQuality: "full",
      notes: null,
      weekStartDate: "2026-05-04",
      prescribedSessionSnapshot: null,
      createdAt: ISO,
      updatedAt: ISO,
    };
    detail.exerciseLogs = [];
    setEventReady(detail);
    // The performed session s-2 (its own exercises) is fetched for editing.
    mockSession.mockReturnValue({
      data: {
        success: true,
        data: {
          session: {
            id: "s-2",
            planId: "p-1",
            name: "Back Day",
            orderIndex: 1,
            focus: "Back",
            estimatedDurationMinutes: 45,
            calorieSurplusPercentage: null,
            exercises: [
              {
                id: REAL_UUID_B,
                sessionId: "s-2",
                exerciseId: null,
                name: "Barbell Row",
                orderIndex: 0,
                sets: 3,
                isWarmup: false,
                createdAt: ISO,
                updatedAt: ISO,
              },
            ],
            createdAt: ISO,
            updatedAt: ISO,
          },
        },
      },
      error: undefined,
      isLoading: false,
    });
    const user = userEvent.setup();
    render(<SetTracker eventId="evt-1" />);

    // Header shows the PERFORMED session (Back Day), not the prescribed one.
    expect(await screen.findByText("Back Day")).toBeInTheDocument();

    await user.click(screen.getByTestId("quick-log-full"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = getLastFetchPayload() as { performedSessionId?: string };
    expect(body.performedSessionId).toBe("s-2");
  });

  it("[locked] a past logged day is read-only (banner shown, save disabled)", () => {
    const detail = baseFixture(); // event.date 2026-05-06 (a past date)
    detail.sessionLog = {
      id: "log-1",
      clientId: "c-1",
      trainingSessionId: "s-1",
      trainingEventId: null,
      completedAt: "2026-05-06",
      completionQuality: "full",
      notes: null,
      weekStartDate: "2026-05-04",
      prescribedSessionSnapshot: null,
      createdAt: ISO,
      updatedAt: ISO,
    };
    setEventReady(detail);
    render(<SetTracker eventId="evt-1" />);

    expect(screen.getByTestId("locked-banner")).toBeInTheDocument();
    expect(screen.getByTestId("save-button")).toBeDisabled();
  });
});
