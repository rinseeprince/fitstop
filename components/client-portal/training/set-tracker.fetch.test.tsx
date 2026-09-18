import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig, type Cache } from "swr";
import type { TrainingEventDetail, TrainingSession } from "@/types/training";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";
import { swrFetcher } from "@/lib/swr-fetcher";
import { SetTracker } from "./set-tracker";

// Real SWR, not the mock the sibling test uses: what this pins is how the
// workout loads across a save and across two visits, which a mocked hook
// cannot show.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));

const { mockPush, mockToast } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

// Required, not optional: this hook imports auth-context, which constructs the
// browser Supabase client at module load and throws without env vars.
vi.mock("@/hooks/use-client-profile", () => ({
  CLIENT_PROFILE_KEY: "/api/client/me",
}));

// Required, not optional: units-context imports auth-context too.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

const ISO = "2026-05-01T00:00:00.000Z";
const EVENT_URL = "/api/client/training/events/evt-1";
const PROFILE = {
  success: true,
  data: { weightUnit: "kg", logsOpenFrom: null, timezone: "UTC" },
};

/** The workout as the server has it; `loggedNotes` = a log saved elsewhere. */
function workout(
  loggedNotes: string | null,
  { id = "evt-1", name = "Push Day A", loggedSessionId = "s-1" } = {},
): TrainingEventDetail {
  return {
    event: {
      id,
      clientId: "c-1",
      trainingPlanId: "p-1",
      trainingSessionId: "s-1",
      date: "2026-05-06",
      sessionName: name,
      sessionFocus: null,
      estimatedCalories: null,
      status: "scheduled",
      sessionLogId: null,
      log: null,
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
        name,
        orderIndex: 0,
        estimatedDurationMinutes: 45,
        calorieSurplusPercentage: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    },
    groups: [
      {
        id: "grp-bench",
        orderIndex: 0,
        ...STRAIGHT_SETS,
        exercises: [
          {
            source: "live",
            exercise: {
              id: "11111111-1111-4111-8111-111111111111",
              sessionId: "s-1",
              groupId: "grp-bench",
              exerciseId: null,
              name: "Bench Press",
              orderIndex: 0,
              sets: 3,
              repsTarget: "8-12",
              isWarmup: false,
              prescribedFields: null,
              createdAt: ISO,
              updatedAt: ISO,
            },
          },
        ],
      },
    ],
    sessionLog:
      loggedNotes === null
        ? null
        : {
            id: "log-1",
            clientId: "c-1",
            trainingSessionId: loggedSessionId,
            trainingEventId: id,
            completedAt: "2026-05-06",
            completionQuality: "partial",
            notes: loggedNotes,
            weekStartDate: "2026-05-04",
            prescribedSessionSnapshot: null,
            createdAt: ISO,
            updatedAt: ISO,
          },
    exerciseLogs: [],
  };
}

const SESSION_URL = "/api/client/training/sessions/s-2";

/** The session a logged swap performed instead, as the server has it. */
function swappedSession(exerciseName: string) {
  const session: TrainingSession = {
    id: "s-2",
    planId: "p-1",
    name: "Pull Day",
    orderIndex: 1,
    estimatedDurationMinutes: 45,
    calorieSurplusPercentage: null,
    createdAt: ISO,
    updatedAt: ISO,
    groups: [
      {
        id: "grp-row",
        sessionId: "s-2",
        orderIndex: 0,
        ...STRAIGHT_SETS,
        exercises: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            sessionId: "s-2",
            groupId: "grp-row",
            exerciseId: null,
            name: exerciseName,
            orderIndex: 0,
            sets: 3,
            repsTarget: "8-12",
            isWarmup: false,
            prescribedFields: null,
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
    ],
  };
  return { success: true, data: { session } };
}

/** The server's workout, visit by visit. */
function serveWorkouts(...visits: TrainingEventDetail[]) {
  const queue = [...visits];
  vi.mocked(swrFetcher).mockImplementation((url: string) => {
    if (url === "/api/client/me") return Promise.resolve(PROFILE);
    if (url === EVENT_URL) return Promise.resolve({ success: true, data: queue.shift() });
    return Promise.reject(new Error(`Unexpected read: ${url}`));
  });
}

const workoutReads = () =>
  vi.mocked(swrFetcher).mock.calls.filter(([url]) => url === EVENT_URL).length;

// One SWR cache for the whole test, kept across the page closing and opening.
function tree(cache: Cache, open: boolean, eventId = "evt-1") {
  return (
    <SWRConfig value={{ provider: () => cache }}>
      {open ? <SetTracker eventId={eventId} date="2026-05-06" /> : null}
    </SWRConfig>
  );
}

describe("SetTracker through real SWR", () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Map() as unknown as Cache;
    vi.mocked(swrFetcher).mockReset();
    mockPush.mockReset();
    mockToast.success.mockReset();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { sessionLogId: "log-1" } }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays on the workout after Complete workout until Home replaces it", async () => {
    serveWorkouts(workout(null));
    const user = userEvent.setup();
    render(tree(cache, true));

    // A save has to record something, so bank the workout first, as a client does.
    await user.click(await screen.findByTestId("mark-all-complete"));
    await user.click(screen.getByTestId("save-button"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/client?date=2026-05-06"));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("Push Day A")).toBeInTheDocument();
    expect(screen.getByTestId("save-button")).toBeDisabled();
    expect(screen.queryByText(/failed to load workout/i)).toBeNull();
    expect(screen.queryByTestId("set-tracker-skeleton")).toBeNull();
    expect(workoutReads()).toBe(1);
  });

  it("reopened inside the dedupe window, fills from a fresh load rather than the last visit's copy", async () => {
    // Between the visits the workout was logged elsewhere (the check-in's
    // training checklist, another device).
    serveWorkouts(workout(null), workout("Logged from the check-in"));
    const { rerender } = render(tree(cache, true));
    expect(await screen.findByTestId("session-notes-toggle")).toBeInTheDocument();

    rerender(tree(cache, false));
    rerender(tree(cache, true));
    expect(screen.getByTestId("set-tracker-skeleton")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>("session-notes").value).toBe(
        "Logged from the check-in",
      ),
    );
    expect(workoutReads()).toBe(2);
  });

  it("reopened inside the dedupe window, loads a swapped-in session fresh too", async () => {
    // The log performed another session, which the coach changed between visits.
    const sessions = [swappedSession("Barbell Row"), swappedSession("Pendlay Row")];
    vi.mocked(swrFetcher).mockImplementation((url: string) => {
      if (url === "/api/client/me") return Promise.resolve(PROFILE);
      if (url === EVENT_URL) {
        return Promise.resolve({
          success: true,
          data: workout("Did the pull day", { loggedSessionId: "s-2" }),
        });
      }
      if (url === SESSION_URL) return Promise.resolve(sessions.shift());
      return Promise.reject(new Error(`Unexpected read: ${url}`));
    });
    const { rerender } = render(tree(cache, true));
    expect((await screen.findAllByText("Barbell Row")).length).toBeGreaterThan(0);

    rerender(tree(cache, false));
    rerender(tree(cache, true));
    expect(screen.getByTestId("set-tracker-skeleton")).toBeInTheDocument();
    expect((await screen.findAllByText("Pendlay Row")).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Barbell Row")).toHaveLength(0);
  });

  it("never renders the error card while another workout loads in its place", async () => {
    // A swap reopens the page on another event without unmounting it.
    vi.mocked(swrFetcher).mockImplementation((url: string) => {
      if (url === "/api/client/me") return Promise.resolve(PROFILE);
      if (url === EVENT_URL) return Promise.resolve({ success: true, data: workout(null) });
      if (url === "/api/client/training/events/evt-2") {
        return Promise.resolve({
          success: true,
          data: workout(null, { id: "evt-2", name: "Pull Day B" }),
        });
      }
      return Promise.reject(new Error(`Unexpected read: ${url}`));
    });
    const { rerender } = render(tree(cache, true));
    expect(await screen.findByText("Push Day A")).toBeInTheDocument();

    // Every node the switch adds, including renders replaced before a paint.
    const added: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => added.push(node.textContent ?? ""));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    rerender(tree(cache, true, "evt-2"));
    expect(await screen.findByText("Pull Day B")).toBeInTheDocument();
    observer.disconnect();

    expect(added.some((text) => /failed to load workout/i.test(text))).toBe(false);
  });

  it("shows the skeleton while the workout loads and the error card only when the load fails", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(swrFetcher).mockImplementation((url: string) =>
      url === "/api/client/me"
        ? Promise.resolve(PROFILE)
        : new Promise((_, reject) => (fail = reject)),
    );
    render(tree(cache, true));

    await waitFor(() => expect(workoutReads()).toBe(1));
    expect(screen.getByTestId("set-tracker-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/failed to load workout/i)).toBeNull();

    vi.spyOn(console, "error").mockImplementation(() => {});
    fail(new Error("API request failed"));
    expect(await screen.findByText(/failed to load workout/i)).toBeInTheDocument();
  });
});
