import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { CreateSessionSlideOver } from "./create-session-slide-over";
import { ProgramDraftProvider, useProgramDraft } from "./program-draft-provider";
import type { SavedPlan, SavedSession } from "@/types/training";

// -- mocks --------------------------------------------------------------------

const backMock = vi.fn();
const replaceMock = vi.fn();
let searchString = "w=0&d=2";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: backMock, replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchString),
}));

let planFixture: SavedPlan | null = null;
vi.mock("@/hooks/use-saved-plan", () => ({
  useSavedPlan: () => ({
    plan: planFixture,
    isLoading: false,
    mutate: vi.fn(() => Promise.resolve(undefined)),
  }),
}));

type FetchCall = { url: string; method: string; body: unknown };
const fetchCalls: FetchCall[] = [];
let createStatus = 201;
vi.stubGlobal(
  "fetch",
  vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Promise.resolve(
      new Response(
        JSON.stringify(
          createStatus === 201 ? { success: true, sessionId: "new-s" } : { error: "boom" },
        ),
        { status: createStatus, headers: { "Content-Type": "application/json" } },
      ),
    );
  }),
);

// -- fixtures -----------------------------------------------------------------

function makeSession(overrides: Partial<SavedSession>): SavedSession {
  return {
    id: "row",
    coachId: "coach-1",
    savedPlanId: "plan-1",
    name: "Rest",
    focus: null,
    orderIndex: 0,
    weekIndex: 0,
    isRest: true,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    exercises: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePlan(day2Session = false): SavedPlan {
  return {
    id: "plan-1",
    coachId: "coach-1",
    name: "P",
    description: null,
    splitType: "custom",
    frequencyPerWeek: 1,
    status: "saved",
    defaultSurplusPercentage: 15,
    source: "manual",
    coachPrompt: null,
    programDurationWeeks: 1,
    sessions: Array.from({ length: 7 }, (_, i) =>
      makeSession({
        id: `s-${i}`,
        orderIndex: i,
        isRest: !(day2Session && i === 2),
        name: day2Session && i === 2 ? "Existing" : "Rest",
      }),
    ),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

// Probe: exposes the target slot's session + the dirty flag so tests can
// assert the working tree without reaching into provider internals.
function SlotProbe({ w, d }: { w: number; d: number }) {
  const { draft, isDirty } = useProgramDraft();
  const session = draft?.weeks[w]?.days[d]?.session ?? null;
  return (
    <>
      <div data-testid="slot-probe">{session ? session.name : "(rest)"}</div>
      <div data-testid="dirty-probe">{isDirty ? "dirty" : "clean"}</div>
    </>
  );
}

// Renders provider + probe + slide-over; `closeSlideOver` unmounts ONLY the
// slide-over (same provider element position → provider state survives),
// which is exactly what browser-back does to the @modal slot.
function renderSlideOver() {
  const tree = (withSlideOver: boolean) => (
    <ProgramDraftProvider savedPlanId="plan-1" target="library">
      <SlotProbe w={0} d={2} />
      {withSlideOver && <CreateSessionSlideOver />}
    </ProgramDraftProvider>
  );
  const view = render(tree(true));
  return {
    ...view,
    closeSlideOver: () => view.rerender(tree(false)),
  };
}

describe("CreateSessionSlideOver", () => {
  beforeEach(() => {
    cleanup();
    fetchCalls.length = 0;
    createStatus = 201;
    searchString = "w=0&d=2";
    planFixture = makePlan();
    backMock.mockClear();
    replaceMock.mockClear();
  });

  it("creates the optimistic Untitled session in the target slot on mount", async () => {
    renderSlideOver();
    await waitFor(() =>
      expect(screen.getByTestId("slot-probe").textContent).toBe("Untitled session"),
    );
    expect(screen.getByText(/Adding to Week 1 · Day 3/)).toBeInTheDocument();
  });

  it("Save POSTs the standalone payload, then closes with the card kept", async () => {
    renderSlideOver();
    await waitFor(() =>
      expect(screen.getByTestId("slot-probe").textContent).toBe("Untitled session"),
    );

    fireEvent.click(screen.getByText("Save session"));

    await waitFor(() => expect(backMock).toHaveBeenCalled());
    const create = fetchCalls.find((c) => c.url === "/api/training/saved-sessions");
    expect(create?.method).toBe("POST");
    expect(create?.body).toMatchObject({ name: "Untitled session", exercises: [] });
    // Copy stays in the day (locked decision 3).
    expect(screen.getByTestId("slot-probe").textContent).toBe("Untitled session");
  });

  it("unmount without save discards the optimistic card (cancel/back path)", async () => {
    const { closeSlideOver } = renderSlideOver();
    await waitFor(() =>
      expect(screen.getByTestId("slot-probe").textContent).toBe("Untitled session"),
    );

    act(() => {
      closeSlideOver();
    });

    // The slot reverted to rest; nothing was persisted; the pre-flow dirty
    // state was restored (this plan was clean — cancel must not leave a
    // phantom "unsaved changes" flag).
    expect(screen.getByTestId("slot-probe").textContent).toBe("(rest)");
    expect(screen.getByTestId("dirty-probe").textContent).toBe("clean");
    expect(fetchCalls.find((c) => c.method === "POST")).toBeUndefined();
  });

  it("save then unmount keeps the card (browser-back after save)", async () => {
    const { closeSlideOver } = renderSlideOver();
    await waitFor(() =>
      expect(screen.getByTestId("slot-probe").textContent).toBe("Untitled session"),
    );

    fireEvent.click(screen.getByText("Save session"));
    await waitFor(() => expect(backMock).toHaveBeenCalled());

    act(() => {
      closeSlideOver();
    });
    expect(screen.getByTestId("slot-probe").textContent).toBe("Untitled session");
  });

  it("re-entry onto an occupied slot edits in place and never discards it", async () => {
    planFixture = makePlan(true); // day 2 already has "Existing"
    const { closeSlideOver } = renderSlideOver();
    await waitFor(() =>
      expect(screen.getByTestId("slot-probe").textContent).toBe("Existing"),
    );

    act(() => {
      closeSlideOver();
    });
    // createdHere stayed false → the pre-existing session survives untouched.
    expect(screen.getByTestId("slot-probe").textContent).toBe("Existing");
    expect(fetchCalls.find((c) => c.method === "POST")).toBeUndefined();
  });

  it("survives StrictMode's simulated remount: card appears and close still works (dev-only deadlock regression)", async () => {
    // StrictMode runs effect setup→cleanup→setup with REFS PERSISTING. A
    // one-way "closed" latch set in the unmount cleanup froze the remounted
    // instance: the card was never re-created (eternal spinner) and every
    // dismiss path was dead. The lifecycle refs are now split so the
    // navigation guard survives the remount while the unmount flag re-arms.
    render(
      <StrictMode>
        <ProgramDraftProvider savedPlanId="plan-1" target="library">
          <SlotProbe w={0} d={2} />
          <CreateSessionSlideOver />
        </ProgramDraftProvider>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("slot-probe").textContent).toBe("Untitled session"),
    );

    // Dismissal must still work — and fire exactly ONE router.back() even
    // when clicked twice (a second back() would pop past the builder).
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(backMock).toHaveBeenCalledTimes(1);
  });

  it("survives StrictMode on the invalid-target path: exactly one back(), no phantom card", async () => {
    searchString = "w=9&d=9";
    render(
      <StrictMode>
        <ProgramDraftProvider savedPlanId="plan-1" target="library">
          <SlotProbe w={0} d={2} />
          <CreateSessionSlideOver />
        </ProgramDraftProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(backMock).toHaveBeenCalled());
    expect(backMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("slot-probe").textContent).toBe("(rest)");
  });

  it("backs out of the intercepted entry when the slot indices are invalid", async () => {
    searchString = "w=9&d=9";
    renderSlideOver();
    await waitFor(() => expect(backMock).toHaveBeenCalledTimes(1));
    // No phantom session was injected anywhere.
    expect(screen.getByTestId("slot-probe").textContent).toBe("(rest)");
  });

  it("missing params never fall back to Week 1 · Day 1 (Number(null) === 0 trap)", async () => {
    searchString = ""; // no w/d at all
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <SlotProbe w={0} d={0} />
        <CreateSessionSlideOver />
      </ProgramDraftProvider>,
    );
    await waitFor(() => expect(backMock).toHaveBeenCalledTimes(1));
    // Day 1 stayed rest — no phantom "Untitled session" injected at (0,0).
    expect(screen.getByTestId("slot-probe").textContent).toBe("(rest)");
  });
});
