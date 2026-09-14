import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import { SWRConfig, type Cache } from "swr";
import { PlacedSessionEditor } from "./placed-session-editor";
import type { PlacedSessionState, SessionEventLink } from "./use-placed-session-editor";
import type { TrainingSession } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


// The exercise picker fetches the catalog on mount — stub it out; these tests
// author nothing through it.
vi.mock(
  "@/components/clients/training/program-builder/exercise-picker",
  () => ({
    ExercisePicker: () => <div data-testid="exercise-picker" />,
  }),
);

type FetchCall = { url: string; method: string; body: unknown };
let fetchCalls: FetchCall[] = [];
let fetchImpl: (url: string, method: string) => Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const SPECS: SetSpec[] = [
  { set_number: 1, set_type: "warmup", reps_min: 10, reps_max: 10 },
  { set_number: 2, set_type: "working", reps_min: 5, reps_max: 8 },
];

const STATE: PlacedSessionState = {
  clientId: "c1",
  planId: "p1",
  sessionId: "s1",
  eventId: "ev1",
  date: "2026-07-24",
};

const SESSION_URL = "/api/clients/c1/training/p1/sessions/s1";

function makePlacedSession(): TrainingSession {
  return {
    id: "s1",
    planId: "p1",
    name: "Push Day A",
    orderIndex: 0,
    focus: "push",
    estimatedDurationMinutes: 45,
    calorieSurplusPercentage: 10,
    exercises: [
      {
        id: "te1",
        sessionId: "s1",
        exerciseId: "123e4567-e89b-12d3-a456-426614174000",
        name: "Bench Press",
        orderIndex: 0,
        sets: 1,
        repsMin: 5,
        repsMax: 8,
        restSeconds: 90,
        isWarmup: false,
        setSpecs: SPECS,
        videoUrl: "https://example.com/bench.mp4",
        prescribedFields: null,
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

const SINGLE_EVENT: SessionEventLink[] = [
  { id: "ev1", date: "2026-07-24", status: "scheduled", isModified: false },
];

const LOGGED_EVENT: SessionEventLink[] = [
  { id: "ev1", date: "2026-07-24", status: "completed", isModified: false },
];

// The clicked day is still scheduled; a SIBLING occurrence is logged. The lock
// is on the session, so the tray must still show it locked.
const LOGGED_SIBLING: SessionEventLink[] = [
  { id: "ev0", date: "2026-07-20", status: "partial", isModified: false },
  { id: "ev1", date: "2026-07-24", status: "scheduled", isModified: false },
];

// All scheduled, deliberately: a logged occurrence anywhere locks the session,
// so a fixture with one could never reach the scope dialog these tests drive.
// ev0 is in the past, so futureScheduledCount is 2 and the dialog opens.
const SHARED_EVENTS: SessionEventLink[] = [
  { id: "ev0", date: "2026-07-20", status: "scheduled", isModified: false },
  { id: "ev1", date: "2026-07-24", status: "scheduled", isModified: false },
  { id: "ev2", date: "2026-07-31", status: "scheduled", isModified: false },
];

function stubFetch(events: SessionEventLink[]) {
  fetchImpl = (url, method) => {
    if (method === "GET" && url === SESSION_URL) {
      return Promise.resolve(
        jsonResponse(200, {
          success: true,
          session: makePlacedSession(),
          events,
          clientToday: "2026-07-22",
        }),
      );
    }
    if (method === "POST" && url.endsWith("/clone")) {
      return Promise.resolve(jsonResponse(200, { success: true, newSessionId: "s2" }));
    }
    return Promise.resolve(jsonResponse(200, { success: true }));
  };
}

function makeHandlers() {
  return {
    onClose: vi.fn<() => void>(),
    onUpdate: vi.fn<() => void>(),
    mutateCalendar: vi.fn<() => Promise<unknown>>(() => Promise.resolve()),
  };
}
type TrayHandlers = ReturnType<typeof makeHandlers>;

// Fresh SWR cache per render — without it a previous test's session GET
// bleeds into the next one. Built once per render so a `rerender` keeps it.
function trayTree(
  handlers: TrayHandlers,
  cache: Cache,
  state: PlacedSessionState | null,
  open: boolean,
) {
  return (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <PlacedSessionEditor
        open={open}
        state={state}
        onClose={handlers.onClose}
        onUpdate={handlers.onUpdate}
        mutateCalendar={handlers.mutateCalendar}
      />
    </SWRConfig>
  );
}

function renderTray(
  state: PlacedSessionState | null = STATE,
  open = true,
): TrayHandlers & {
  rerenderTray: (state: PlacedSessionState | null, open: boolean) => void;
} {
  const handlers = makeHandlers();
  const cache: Cache = new Map();
  const { rerender } = render(trayTree(handlers, cache, state, open));
  return {
    ...handlers,
    rerenderTray: (next, nextOpen) => rerender(trayTree(handlers, cache, next, nextOpen)),
  };
}

function callsBy(method: string): FetchCall[] {
  return fetchCalls.filter((c) => c.method === method);
}

// jsdom computes no animation, so Radix unmounts a closing card at once. Radix
// holds a card while its animation name changes, as the slide and the fade do
// in a browser, so naming one keeps the closing frame on the page to be read.
function holdExitAnimation() {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const styles = computed(element, pseudo);
    if (
      element instanceof HTMLElement &&
      (element.dataset.slot === "sheet-content" || element.dataset.slot === "dialog-content")
    ) {
      Object.defineProperty(styles, "animationName", {
        get: () => (element.dataset.state === "closed" ? "exit" : "enter"),
      });
    }
    return styles;
  });
}

function closingCard(slot: "sheet-content" | "dialog-content"): HTMLElement {
  const card = document.querySelector<HTMLElement>(
    `[data-slot="${slot}"][data-state="closed"]`,
  );
  if (!card) throw new Error(`no closing ${slot} on the page`);
  return card;
}

/**
 * The FOOTER's Close. The Sheet renders its own icon-only close with the same
 * accessible name (`sheet.tsx:91`), so the role query alone is ambiguous.
 */
function footerCloseButtons(): HTMLElement[] {
  return screen
    .getAllByRole("button", { name: "Close" })
    .filter((b) => b.getAttribute("data-slot") !== "sheet-close");
}

describe("PlacedSessionEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];
    stubFetch(SINGLE_EVENT);
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      fetchCalls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return fetchImpl(url, method);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the placed session and seeds the editor from it", async () => {
    renderTray();
    expect(await screen.findByDisplayValue("Push Day A")).toBeDefined();
    expect(screen.getAllByText("Bench Press").length).toBeGreaterThan(0);
    expect(callsBy("GET")[0].url).toBe(SESSION_URL);
  });

  it("saves directly via PUT (no scope dialog) with a single future occurrence, preserving setSpecs/videoUrl", async () => {
    const handlers = renderTray();
    await screen.findByDisplayValue("Push Day A");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalledTimes(1));

    expect(callsBy("POST")).toHaveLength(0);
    const puts = callsBy("PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe(SESSION_URL);
    const body = puts[0].body as {
      name: string;
      exercises: Array<{ setSpecs: SetSpec[]; videoUrl: string }>;
    };
    expect(body.name).toBe("Push Day A");
    expect(body.exercises[0].setSpecs).toEqual(SPECS);
    expect(body.exercises[0].videoUrl).toBe("https://example.com/bench.mp4");
    expect(handlers.mutateCalendar).toHaveBeenCalled();
    expect(handlers.onUpdate).toHaveBeenCalled();
  });

  it("offers the scope dialog when the session repeats; 'all' PUTs the original session", async () => {
    stubFetch(SHARED_EVENTS);
    const handlers = renderTray();
    await screen.findByDisplayValue("Push Day A");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("All occurrences")).toBeDefined();
    fireEvent.click(screen.getByText("All occurrences"));

    await waitFor(() => expect(handlers.onClose).toHaveBeenCalledTimes(1));
    expect(callsBy("POST")).toHaveLength(0);
    expect(callsBy("PUT")[0].url).toBe(SESSION_URL);
  });

  it("'just this day' clones the event's session, then PUTs the clone", async () => {
    stubFetch(SHARED_EVENTS);
    const handlers = renderTray();
    await screen.findByDisplayValue("Push Day A");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByText("Just this day"));

    await waitFor(() => expect(handlers.onClose).toHaveBeenCalledTimes(1));
    const posts = callsBy("POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(`${SESSION_URL}/clone`);
    expect(posts[0].body).toMatchObject({ eventId: "ev1" });
    const cloneBody = posts[0].body as { exercises: Array<{ setSpecs: SetSpec[] }> };
    expect(cloneBody.exercises[0].setSpecs).toEqual(SPECS);
    // The builder-grade pass lands on the CLONE (meta + event snapshot).
    const puts = callsBy("PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe("/api/clients/c1/training/p1/sessions/s2");
  });

  it("closes a clean tray without a discard prompt or any write", async () => {
    const handlers = renderTray();
    await screen.findByDisplayValue("Push Day A");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(callsBy("PUT")).toHaveLength(0);
    expect(callsBy("POST")).toHaveLength(0);
  });

  it("guards a dirty cancel behind the discard dialog", async () => {
    const handlers = renderTray();
    const nameInput = await screen.findByDisplayValue("Push Day A");
    fireEvent.blur(nameInput, { target: { value: "Renamed locally" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Discard changes?")).toBeDefined();
    expect(handlers.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(handlers.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(callsBy("PUT")).toHaveLength(0);
    expect(callsBy("POST")).toHaveLength(0);
  });

  it("opens a logged day READ-ONLY: no Save, a lock line naming the day, inputs disabled", async () => {
    stubFetch(LOGGED_EVENT);
    renderTray();

    const nameInput = await screen.findByDisplayValue("Push Day A");
    // mode="view" — every field of the shared editor body disables.
    expect(nameInput).toBeDisabled();

    // Save is HIDDEN, not disabled: the day is structurally uneditable.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(footerCloseButtons()).toHaveLength(1);
    expect(
      screen.getByText(
        "The client logged this session on Fri, Jul 24, so it can no longer be edited.",
      ),
    ).toBeDefined();
  });

  it("locks a scheduled day whose SIBLING occurrence is logged, naming the logged day", async () => {
    stubFetch(LOGGED_SIBLING);
    renderTray();

    await screen.findByDisplayValue("Push Day A");

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    // The earliest logged occurrence, not the day the coach clicked — without
    // it the lock reads as a bug on a future day.
    expect(
      screen.getByText(
        "The client logged this session on Mon, Jul 20, so it can no longer be edited.",
      ),
    ).toBeDefined();
  });

  it("closes a locked tray with no write and no discard prompt", async () => {
    stubFetch(LOGGED_EVENT);
    const handlers = renderTray();
    await screen.findByDisplayValue("Push Day A");

    fireEvent.click(footerCloseButtons()[0]);

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(callsBy("PUT")).toHaveLength(0);
    expect(callsBy("POST")).toHaveLength(0);
  });

  it("stays open and surfaces the error when the PUT fails", async () => {
    fetchImpl = (url, method) => {
      if (method === "GET" && url === SESSION_URL) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            session: makePlacedSession(),
            events: SINGLE_EVENT,
            clientToday: "2026-07-22",
          }),
        );
      }
      return Promise.resolve(jsonResponse(500, { error: "Failed to save session" }));
    };
    const handlers = renderTray();
    await screen.findByDisplayValue("Push Day A");

    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    await waitFor(() => expect(save).not.toBeDisabled());
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it("stays open with Save live when the draft fails the client-side check", async () => {
    // Over the schema's 480-minute cap, so the save stops before any write.
    fetchImpl = (url, method) => {
      if (method === "GET" && url === SESSION_URL) {
        return Promise.resolve(
          jsonResponse(200, {
            success: true,
            session: { ...makePlacedSession(), estimatedDurationMinutes: 600 },
            events: SINGLE_EVENT,
            clientToday: "2026-07-22",
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { success: true }));
    };
    const handlers = renderTray();
    await screen.findByDisplayValue("Push Day A");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(callsBy("PUT")).toHaveLength(0);
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  // `open` and the subject are two props: the tray closes on `open` alone and
  // fetches on the subject alone, so a closing tray still has its session to
  // render (CONVENTIONS §7 → "No frame disagrees").
  describe("open is its own prop, apart from the subject", () => {
    it("stays shut while open is false, even with a subject in hand, and still fetches it", async () => {
      renderTray(STATE, false);

      await waitFor(() => expect(callsBy("GET")).toHaveLength(1));
      expect(callsBy("GET")[0].url).toBe(SESSION_URL);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });

    it("heads the tray with the subject's day", async () => {
      renderTray();
      await screen.findByDisplayValue("Push Day A");
      expect(screen.getByText("Fri, Jul 24")).toBeDefined();
    });

    it("re-seeds from the session when the next open hands in a fresh subject for the same day", async () => {
      const tray = renderTray();
      const nameInput = await screen.findByDisplayValue("Push Day A");
      fireEvent.blur(nameInput, { target: { value: "Renamed locally" } });
      expect(await screen.findByDisplayValue("Renamed locally")).toBeDefined();

      // The discard closes on `open` alone; the next open replaces the subject.
      tray.rerenderTray(STATE, false);
      tray.rerenderTray({ ...STATE }, true);

      expect(await screen.findByDisplayValue("Push Day A")).toBeDefined();
      expect(screen.queryByDisplayValue("Renamed locally")).toBeNull();
    });

    it("closes a successful save with Save still pending; the next open clears it", async () => {
      holdExitAnimation();
      const tray = renderTray();
      await screen.findByDisplayValue("Push Day A");

      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(tray.onClose).toHaveBeenCalledTimes(1));
      // Flush the save's settle, then close the way the host does: `open` alone.
      await act(async () => {});
      tray.rerenderTray(STATE, false);

      // The sliding-out footer keeps the pending frame it closed on.
      const closing = closingCard("sheet-content");
      expect(within(closing).getByRole("button", { name: "Save" })).toBeDisabled();
      expect(within(closing).getByRole("button", { name: "Cancel" })).toBeDisabled();

      tray.rerenderTray({ ...STATE }, true);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled(),
      );
      expect(screen.getByRole("button", { name: "Cancel" })).not.toBeDisabled();
    });

    it("keeps the seeded session and its day on the tray while it slides out", async () => {
      holdExitAnimation();
      const tray = renderTray();
      await screen.findByDisplayValue("Push Day A");

      tray.rerenderTray(STATE, false);

      const closing = closingCard("sheet-content");
      expect(within(closing).getByDisplayValue("Push Day A")).toBeDefined();
      expect(within(closing).getByText("Fri, Jul 24")).toBeDefined();
      expect(closing.querySelector(".animate-spin")).toBeNull();
    });

    it("keeps the scope card as it was while the chosen scope closes it", async () => {
      holdExitAnimation();
      stubFetch(SHARED_EVENTS);
      const handlers = renderTray();
      await screen.findByDisplayValue("Push Day A");

      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      fireEvent.click(await screen.findByText("Just this day"));

      // The click closed the card and started the save in one commit; the
      // fading card shows no trace of the save.
      const closing = closingCard("dialog-content");
      expect(within(closing).getByText("Just this day").closest("button")).not.toBeDisabled();
      expect(within(closing).getByRole("button", { name: "Cancel" })).not.toBeDisabled();
      expect(closing.querySelector(".animate-spin")).toBeNull();

      await waitFor(() => expect(handlers.onClose).toHaveBeenCalledTimes(1));
    });
  });
});
