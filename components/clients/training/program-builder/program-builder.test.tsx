import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { PAST_LOCKED } from "./program-builder-lock-model";
import { ProgramBuilder } from "./program-builder";
import { ProgramDraftProvider } from "./program-draft-provider";
import { addDaysToDateString } from "@/lib/date-helpers";
import type { PlanEditDay, PlanForEditing } from "@/services/plan-edit-service";
import type { SavedPlan, SavedSession } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { STRAIGHT_SETS, sessionExercises } from "@/utils/exercise-groups";

// -- mocks --------------------------------------------------------------------

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));
// Whether a coach page precedes the builder's page — what its exit reads. The
// exit LEAVES the page when one does and takes its fallback when none does.
const { coachHistory, leaveMock } = vi.hoisted(() => ({
  coachHistory: { current: false },
  leaveMock: vi.fn(),
}));
vi.mock("@/lib/coach-history", () => ({
  leaveCoachPage: (fallback?: () => void) => {
    if (coachHistory.current) leaveMock();
    else fallback?.();
  },
}));

// Toast spy so the save-as-workout flow can assert the deduped-name copy.
const { toastSpy } = vi.hoisted(() => ({
  toastSpy: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastSpy }));

// The library header band's bell is SWR-backed and unrelated to the builder.
vi.mock("@/components/navbar/notifications-dropdown", () => ({
  NotificationsDropdown: () => null,
}));

const mutateMock = vi.fn(() => Promise.resolve(undefined));
let planFixture: SavedPlan | null = null;
vi.mock("@/hooks/use-saved-plan", () => ({
  useSavedPlan: () => ({ plan: planFixture, isLoading: false, mutate: mutateMock }),
}));

// The session-library drawer + add-session popover read the standalone list.
vi.mock("@/hooks/use-standalone-sessions", () => ({
  useStandaloneSessions: () => ({
    sessions: [],
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

// The duplicate-week progression dialog classifies compounds off the catalog.
// A real UUID: the overwrite schema validates exerciseId with z.string().uuid().
const BENCH_CATALOG_ID = "3b8e7a2e-1111-4222-8333-000000000001";
vi.mock("@/hooks/use-exercise-catalog", () => ({
  useExerciseCatalog: () => ({
    exercises: [
      {
        id: "3b8e7a2e-1111-4222-8333-000000000001",
        coachId: null,
        name: "Bench Press",
        muscleGroup: "chest",
        equipment: "barbell",
        category: "compound",
        aliases: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    isLoading: false,
    error: null,
    mutate: vi.fn(),
  }),
}));

// Stub the shared apply dialog: capture the props ProgramBuilder passes it
// (inlinePlan present ⇒ type:"inline"; absent ⇒ type:"plan") without dragging
// in its SWR / nutrition-calendar / date-helper machinery.
const { applyDialogSpy } = vi.hoisted(() => ({ applyDialogSpy: vi.fn() }));
vi.mock("@/components/training-library/apply-to-client-dialog", () => ({
  ApplyToClientDialog: (props: {
    open: boolean;
    savedPlan: { id: string };
    inlinePlan?: { name: string; sessions: unknown[] } | null;
    preselectedClientId?: string;
  }) => {
    if (props.open) applyDialogSpy(props);
    return props.open ? <div data-testid="apply-dialog" /> : null;
  },
}));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

// Pass-through: the real sheet still renders (the save-as-workout flows click
// its footer), and a sibling marker exposes what the builder hands it. jsdom
// unmounts a closing Radix node at once, so what a closing sheet renders from
// is only observable as its props.
vi.mock("./session-editor-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session-editor-sheet")>();
  return {
    SessionEditorSheet: (props: ComponentProps<typeof actual.SessionEditorSheet>) => (
      <>
        <span
          data-testid="session-sheet"
          data-open={String(props.open)}
          data-session={props.session?.name ?? ""}
        />
        <actual.SessionEditorSheet {...props} />
      </>
    ),
  };
});


type FetchCall = { url: string; method: string; body: unknown };
const fetchCalls: FetchCall[] = [];
let promoteStatus = 200;
let overwriteStatus = 200;
// Placed-plan target: what the plan editor's read (GET …/edit) serves, and
// the status its save (PUT …/edit) answers with.
let planEditFixture: PlanForEditing | null = null;
let editStatus = 200;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

vi.stubGlobal(
  "fetch",
  vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    fetchCalls.push({
      url: u,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (u.endsWith("/overwrite")) {
      return Promise.resolve(
        jsonResponse(overwriteStatus, overwriteStatus === 200 ? { success: true } : { error: "boom" }),
      );
    }
    if (u.endsWith("/promote")) {
      return Promise.resolve(
        jsonResponse(promoteStatus, promoteStatus === 200 ? { success: true } : { success: false, error: "name conflict" }),
      );
    }
    if (u === "/api/training/saved-sessions" && init?.method === "POST") {
      // Save-day-as-workout: the server deduped the name server-side.
      return Promise.resolve(
        jsonResponse(201, { success: true, sessionId: "s-new", name: "Push (copy)" }),
      );
    }
    if (u.endsWith("/edit")) {
      if (init?.method === "PUT") {
        return Promise.resolve(
          jsonResponse(
            editStatus,
            editStatus === 200
              ? {
                  success: true,
                  data: { firstDay: "2026-07-22", lastDay: "2026-08-01", sessionsWritten: 5 },
                }
              : { error: "This plan changed while you were editing" },
          ),
        );
      }
      return Promise.resolve(jsonResponse(200, { success: true, data: planEditFixture }));
    }
    return Promise.resolve(jsonResponse(200, { success: true }));
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
    dayOrder: 0,
    isRest: true,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** A freshly created draft: 1 week, Day 1 = training with surplus 0, rest Rest. */
function makeDraftPlan(): SavedPlan {
  return {
    id: "plan-1",
    coachId: "coach-1",
    name: "Untitled program",
    description: null,
    splitType: "custom",
    frequencyPerWeek: 1,
    status: "draft",
    // 0 on purpose: pins the mapper/serializer 0-vs-null distinction.
    defaultSurplusPercentage: 0,
    source: "manual",
    coachPrompt: null,
    programDurationWeeks: null,
    sessions: [
      makeSession({
        id: "s-0",
        name: "Push",
        isRest: false,
        orderIndex: 0,
        calorieSurplusPercentage: 0,
      }),
      ...Array.from({ length: 6 }, (_, i) =>
        makeSession({ id: `s-${i + 1}`, orderIndex: i + 1 }),
      ),
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const overwriteCall = () => fetchCalls.find((c) => c.url.endsWith("/overwrite"));
const promoteCall = () => fetchCalls.find((c) => c.url.endsWith("/promote"));
const durationPatch = () => fetchCalls.find((c) => c.method === "PATCH");

describe("ProgramBuilder save flow", () => {
  beforeEach(() => {
    cleanup();
    fetchCalls.length = 0;
    promoteStatus = 200;
    overwriteStatus = 200;
    planFixture = makeDraftPlan();
    mutateMock.mockClear();
    pushMock.mockClear();
    leaveMock.mockClear();
    coachHistory.current = false;
    toastSpy.success.mockClear();
    toastSpy.error.mockClear();
  });

  const savedSessionPost = () =>
    fetchCalls.filter(
      (c) => c.url === "/api/training/saved-sessions" && c.method === "POST",
    );

  it("opens a draft plan straight into edit mode with the seeded grid", () => {
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    expect(screen.getByLabelText("Save program")).toBeInTheDocument();
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getAllByText("Rest")).toHaveLength(6);
    // Header: editable name + focus + description, and the stat row is gone.
    expect(screen.getByLabelText("Program name")).toBeInTheDocument();
    expect(screen.getByLabelText("Program focus")).toBeInTheDocument();
    expect(screen.getByLabelText("Program description")).toBeInTheDocument();
    expect(screen.queryByText(/active client/)).toBeNull();
  });

  it("titles the main column, leaving the panel a bare back row and the hero no exit", () => {
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    // The page title sits in the content area's header band, mirroring the
    // client detail pages; the panel only names where its arrow returns to.
    expect(
      screen.getByRole("heading", { level: 1, name: "Program Builder" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All programs/ })).toBeInTheDocument();
    // The hero's back arrow is gone — one exit, and it carries the guard.
    expect(screen.queryByLabelText("Back to programs")).toBeNull();
  });

  it("leaves via the panel arrow when clean, and confirms first when dirty", () => {
    const { unmount } = render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: /All programs/ }));
    expect(pushMock).toHaveBeenCalledWith("/dashboard/programs");
    unmount();

    pushMock.mockClear();
    leaveMock.mockClear();
    coachHistory.current = false;
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    const nameInput = screen.getByLabelText("Program name");
    fireEvent.change(nameInput, { target: { value: "Renamed block" } });
    fireEvent.blur(nameInput);

    fireEvent.click(screen.getByRole("link", { name: /All programs/ }));
    // Previously the panel link navigated away from a dirty draft silently.
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("LEAVES the page from the panel arrow, and after a clean save, when a coach page precedes the builder", async () => {
    coachHistory.current = true;
    const { unmount } = render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: /All programs/ }));
    expect(leaveMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
    unmount();

    leaveMock.mockClear();
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByLabelText("Save program"));
    await waitFor(() => expect(leaveMock).toHaveBeenCalledTimes(1));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("Save program posts the whole tree (surplus 0 preserved), PATCHes duration, promotes, then returns to the programs list", async () => {
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByLabelText("Save program"));

    // A clean save navigates back to the programs list.
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/dashboard/programs"),
    );

    const overwrite = overwriteCall()!;
    expect(overwrite.method).toBe("POST");
    const body = overwrite.body as {
      name: string;
      defaultSurplusPercentage: number | null;
      sessions: Array<{
        name: string;
        isRest: boolean;
        weekIndex: number;
        orderIndex: number;
        calorieSurplusPercentage: number | null;
        groups: unknown[];
      }>;
    };
    // Program-level default surplus survives — including 0.
    expect(body.defaultSurplusPercentage).toBe(0);
    expect(body.sessions).toHaveLength(7);
    // Per-session surplus 0 survives; isRest explicit on every row.
    expect(body.sessions[0]).toMatchObject({
      name: "Push",
      isRest: false,
      weekIndex: 0,
      orderIndex: 0,
      calorieSurplusPercentage: 0,
    });
    expect(body.sessions.slice(1).every((s) => s.isRest && s.groups.length === 0)).toBe(true);

    // programDurationWeeks kept truthful (null → 1) on every save.
    expect(durationPatch()!.body).toMatchObject({ programDurationWeeks: 1 });
    // Draft → promote with NO saveSessionsIndividually flag.
    expect(promoteCall()!.body).toEqual({});
    // SWR refreshed before local state cleared.
    expect(mutateMock).toHaveBeenCalled();
  });

  it("keeps edit mode when promote returns 409 (overwrite already committed)", async () => {
    promoteStatus = 409;
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByLabelText("Save program"));

    await waitFor(() => expect(promoteCall()).toBeTruthy());
    expect(overwriteCall()).toBeTruthy();
    // Still in edit mode — Save stays available for the rename-and-retry; a
    // non-clean save must NOT navigate away.
    expect(screen.getByLabelText("Save program")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit program")).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps the local draft and edit mode when the overwrite 500s", async () => {
    overwriteStatus = 500;
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByLabelText("Save program"));

    await waitFor(() => expect(overwriteCall()).toBeTruthy());
    // No promote attempt, no mode flip, grid content intact, no navigation.
    expect(promoteCall()).toBeUndefined();
    expect(screen.getByLabelText("Save program")).toBeInTheDocument();
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("saved plans open read-only; Edit enables authoring", () => {
    planFixture = { ...makeDraftPlan(), status: "saved" };
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    expect(screen.getByLabelText("Edit program")).toBeInTheDocument();
    expect(screen.queryByLabelText("Save program")).toBeNull();
    expect(screen.queryByText(/Add session/)).toBeNull();

    fireEvent.click(screen.getByLabelText("Edit program"));
    expect(screen.getByLabelText("Save program")).toBeInTheDocument();
  });

  it("Cancel editing exits to view mode when there are no changes (never stuck)", () => {
    planFixture = { ...makeDraftPlan(), status: "saved" };
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByLabelText("Edit program"));
    expect(screen.getByLabelText("Save program")).toBeInTheDocument();
    // Not dirty → the control reads "Cancel editing" and leaves edit mode.
    fireEvent.click(screen.getByLabelText("Cancel editing"));
    expect(screen.getByLabelText("Edit program")).toBeInTheDocument();
    expect(screen.queryByLabelText("Save program")).toBeNull();
  });

  it("duplicate-with-progression previews, commits a progressed week, and saves it without touching week 0", async () => {
    const benchSpecs: SetSpec[] = [
      { set_number: 1, set_type: "warmup", load_type: "absolute", load_value: 60 },
      { set_number: 2, set_type: "working", load_type: "absolute", load_value: 100 },
      { set_number: 3, set_type: "working", load_type: "absolute", load_value: 90 },
    ];
    const plan = makeDraftPlan();
    plan.sessions[0].groups = [
      {
        id: "grp-row-1",
        savedSessionId: "s-0",
        orderIndex: 0,
        ...STRAIGHT_SETS,
        exercises: [
          {
            id: "ex-row-1",
            savedSessionId: "s-0",
            groupId: "grp-row-1",
            exerciseId: BENCH_CATALOG_ID,
            name: "Bench Press",
            orderIndex: 0,
            sets: 2,
            repsMin: 8,
            repsMax: 10,
            repsTarget: null,
            rpeTarget: null,
            percentage1rm: null,
            tempo: null,
            restSeconds: null,
            isWarmup: false,
            notes: null,
            setSpecs: benchSpecs.map((s) => ({ ...s })),
            videoUrl: null,
            prescribedFields: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
    ];
    planFixture = plan;
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );

    // Dialog is unmounted until the affordance is clicked (count-sensitive
    // queries like the 6 Rest cells rely on no hidden preview content).
    expect(screen.queryByText("Duplicate Week 1")).toBeNull();
    expect(screen.getAllByText("Rest")).toHaveLength(6);

    fireEvent.click(screen.getByLabelText("Duplicate week 1 with progression"));
    expect(screen.getByText("Duplicate Week 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compounds only" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate week" }));

    // Dialog closed, progressed week inserted: two Push cards on the grid.
    expect(screen.queryByText("Duplicate Week 1")).toBeNull();
    expect(screen.getAllByText("Push")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Save program"));
    await waitFor(() => expect(overwriteCall()).toBeTruthy());

    const body = overwriteCall()!.body as {
      sessions: Array<{
        name: string;
        weekIndex: number;
        isRest: boolean;
        groups: Array<{
          exercises: Array<{ setSpecs: Array<{ set_type?: string; load_value?: number }> | null }>;
        }>;
      }>;
    };
    expect(body.sessions).toHaveLength(14);
    const week0Push = body.sessions.find((s) => s.weekIndex === 0 && !s.isRest)!;
    const week1Push = body.sessions.find((s) => s.weekIndex === 1 && !s.isRest)!;
    // Week 0 serializes byte-identical to the fixture prescription.
    expect(sessionExercises(week0Push)[0].setSpecs).toEqual(benchSpecs);
    // Week 1 carries the progressed working loads; warm-up untouched.
    expect(sessionExercises(week1Push)[0].setSpecs!.map((s) => s.load_value)).toEqual([
      60, 102.5, 92.5,
    ]);
  });

  it("Save as workout POSTs the day's session with dedupeName and surfaces the final name", async () => {
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    // Open the Day 1 session in the editor sheet, then extract it.
    fireEvent.click(screen.getByText("Push"));
    fireEvent.click(screen.getByRole("button", { name: /Save as workout/ }));

    await waitFor(() => expect(savedSessionPost()).toHaveLength(1));
    expect(savedSessionPost()[0].body).toMatchObject({
      name: "Push",
      dedupeName: true,
      groups: [],
    });
    await waitFor(() =>
      expect(toastSpy.success).toHaveBeenCalledWith(expect.stringContaining("Push (copy)"), {
        description: "Find it under Programs → Sessions.",
      }),
    );
  });

  it("Save as workout fires exactly one POST on a double click", async () => {
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByText("Push"));
    const button = screen.getByRole("button", { name: /Save as workout/ });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(savedSessionPost()).toHaveLength(1));
    // Give any stray second request a chance to land before asserting.
    await waitFor(() =>
      expect(toastSpy.success).toHaveBeenCalledWith(expect.stringContaining("Push (copy)"), {
        description: "Find it under Programs → Sessions.",
      }),
    );
    expect(savedSessionPost()).toHaveLength(1);
  });

  it("Save as workout is available in view mode (it never mutates the draft)", async () => {
    planFixture = { ...makeDraftPlan(), status: "saved" };
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByText("Push"));
    fireEvent.click(screen.getByRole("button", { name: /Save as workout/ }));

    await waitFor(() => expect(savedSessionPost()).toHaveLength(1));
    expect(savedSessionPost()[0].body).toMatchObject({ dedupeName: true });
  });
});

describe("ProgramBuilder session sheet — the subject outlives the close", () => {
  beforeEach(() => {
    cleanup();
    fetchCalls.length = 0;
    planFixture = makeDraftPlan();
  });

  const renderLibrary = () =>
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
  const sheet = () => screen.getByTestId("session-sheet");
  const launcher = () => screen.queryByLabelText("Open the program assistant");

  it("Done closes the sheet and keeps its session; the next open replaces it", () => {
    const plan = makeDraftPlan();
    plan.sessions[2] = makeSession({ id: "s-2", name: "Pull", isRest: false, orderIndex: 2 });
    planFixture = plan;
    renderLibrary();

    fireEvent.click(screen.getByText("Push"));
    expect(sheet()).toHaveAttribute("data-open", "true");
    expect(sheet()).toHaveAttribute("data-session", "Push");
    expect(screen.getByRole("dialog", { name: "Push" })).toBeInTheDocument();
    // The corner launcher hides while the sheet's own footer carries it.
    expect(launcher()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Radix re-renders the closing sheet from these through its exit.
    expect(sheet()).toHaveAttribute("data-open", "false");
    expect(sheet()).toHaveAttribute("data-session", "Push");
    // The real sheet closes on `open`, not on the session it still holds.
    expect(screen.queryByRole("dialog")).toBeNull();
    // Back with the close, though the session is still held.
    expect(launcher()).toBeInTheDocument();

    fireEvent.click(screen.getByText("Pull"));
    expect(sheet()).toHaveAttribute("data-open", "true");
    expect(sheet()).toHaveAttribute("data-session", "Pull");
    expect(screen.getByRole("dialog", { name: "Pull" })).toBeInTheDocument();
  });

  it("a session dropped from the draft while its sheet is up closes the sheet", () => {
    renderLibrary();
    fireEvent.click(screen.getByText("Push"));
    expect(sheet()).toHaveAttribute("data-open", "true");

    // The card's remove stands in for an assistant op removing the session.
    fireEvent.click(screen.getByLabelText("Remove session"));
    expect(sheet()).toHaveAttribute("data-open", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(launcher()).toBeInTheDocument();
  });
});

describe("ProgramBuilder client-draft mode (Phase 5)", () => {
  beforeEach(() => {
    cleanup();
    fetchCalls.length = 0;
    // A saved library template — the client editor opens it in view mode.
    planFixture = { ...makeDraftPlan(), status: "saved" };
    mutateMock.mockClear();
    pushMock.mockClear();
    leaveMock.mockClear();
    coachHistory.current = false;
    applyDialogSpy.mockClear();
  });

  const renderClientDraft = () =>
    render(
      <ProgramDraftProvider
        savedPlanId="plan-1"
        target="client-draft"
        clientId="client-1"
        clientName="Jane Doe"
      >
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );

  type ApplyProps = {
    inlinePlan?: {
      name: string;
      sessions: unknown[];
      defaultSurplusPercentage?: number | null;
    } | null;
    savedPlan: { id: string };
    preselectedClientId?: string;
  };
  const lastApplyProps = () =>
    applyDialogSpy.mock.calls.at(-1)?.[0] as ApplyProps | undefined;

  const openApplyDialog = () => {
    fireEvent.click(screen.getByRole("button", { name: "Apply to client" }));
    // The reapply confirmation precedes the dialog (date-agnostic copy).
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  };

  it("mounts a saved template as the client editor: Apply, no library commit or back link", () => {
    renderClientDraft();
    expect(
      screen.getByRole("button", { name: "Apply to client" }),
    ).toBeInTheDocument();
    // View mode with Edit available.
    expect(screen.getByLabelText("Edit program")).toBeInTheDocument();
    // Library-only chrome is gone.
    expect(screen.queryByLabelText("Save program")).toBeNull();
    expect(screen.queryByLabelText("Delete program")).toBeNull();
    expect(screen.queryByText("All programs")).toBeNull();
    // The panel titles with the client, not the generic "Program Builder".
    expect(screen.getByText("Editing for")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("Program Builder")).toBeNull();
  });

  it("Apply with no edits places the pristine template (type:plan; no inline body, template untouched)", async () => {
    renderClientDraft();
    openApplyDialog();

    await waitFor(() =>
      expect(screen.getByTestId("apply-dialog")).toBeInTheDocument(),
    );
    const props = lastApplyProps()!;
    expect(props.inlinePlan).toBeUndefined();
    expect(props.savedPlan.id).toBe("plan-1");
    expect(props.preselectedClientId).toBe("client-1");
    // The library template is never overwritten or deleted.
    expect(fetchCalls.some((c) => c.url.endsWith("/overwrite"))).toBe(false);
    expect(fetchCalls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("Apply with unsaved edits places the edited copy inline (type:inline; template untouched)", async () => {
    renderClientDraft();
    fireEvent.click(screen.getByLabelText("Edit program"));
    // Name/focus are template identity (read-only here) — dirty via the
    // per-client surplus instead.
    const surplusInput = screen.getByLabelText("Default calorie surplus percent");
    fireEvent.change(surplusInput, { target: { value: "35" } });
    fireEvent.blur(surplusInput);

    openApplyDialog();

    await waitFor(() =>
      expect(screen.getByTestId("apply-dialog")).toBeInTheDocument(),
    );
    const props = lastApplyProps()!;
    expect(props.inlinePlan).toBeTruthy();
    expect(props.inlinePlan!.defaultSurplusPercentage).toBe(35);
    // Every slot serializes (rest rows included) — 7 for the one-week template.
    expect(props.inlinePlan!.sessions).toHaveLength(7);
    // Editing the client's copy never overwrites or deletes the library template.
    expect(fetchCalls.some((c) => c.url.endsWith("/overwrite"))).toBe(false);
    expect(fetchCalls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("Apply is reachable while dirty (the old draft-editor disabled it)", () => {
    renderClientDraft();
    fireEvent.click(screen.getByLabelText("Edit program"));
    const surplusInput = screen.getByLabelText("Default calorie surplus percent");
    fireEvent.change(surplusInput, { target: { value: "35" } });
    fireEvent.blur(surplusInput);
    expect(
      screen.getByRole("button", { name: "Apply to client" }),
    ).not.toBeDisabled();
  });

  it("keeps program name + focus read-only in the client editor (template identity)", () => {
    renderClientDraft();
    fireEvent.click(screen.getByLabelText("Edit program"));
    // Even in edit mode the program identity isn't editable here — no inputs.
    expect(screen.queryByLabelText("Program name")).toBeNull();
    expect(screen.queryByLabelText("Program focus")).toBeNull();
    expect(screen.queryByLabelText("Program description")).toBeNull();
    // But the surplus (client-specific) is adjustable.
    expect(
      screen.getByLabelText("Default calorie surplus percent"),
    ).not.toBeDisabled();
  });

  it("create-blank builds the session in-memory (no /dashboard/programs route push)", () => {
    renderClientDraft();
    fireEvent.click(screen.getByLabelText("Edit program"));
    expect(screen.getAllByText("Rest")).toHaveLength(6);

    fireEvent.click(screen.getByLabelText("Add session to day 2"));
    fireEvent.click(screen.getByRole("button", { name: "Create blank session" }));

    // Placed in-memory; the routed create-blank slide-over is never navigated to.
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getAllByText("Rest")).toHaveLength(5);
    // The same click opens the new session in the editor sheet.
    expect(screen.getByTestId("session-sheet")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("session-sheet")).toHaveAttribute("data-session", "Day 2");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Placed-plan target: the plan editor — its read, its day rules, its save.
// ═════════════════════════════════════════════════════════════════════════════

const EDIT_URL = "/api/clients/client-1/training/plan-1/edit";
const PLAN_START = "2026-07-15";
const isTrainingPos = (i: number) => i % 7 === 0 || i % 7 === 2 || i % 7 === 4;
/** The read lays a session on days 1, 3 and 5 of each week, up to the limit. */
const holdsSession = (i: number) => isTrainingPos(i) && i <= 17;
/** The calendar entry of the session at `place` on the day at `position`. */
const eventAt = (position: number, place = 1) =>
  `e0000000-0000-4000-8000-${String(position * 10 + place).padStart(12, "0")}`;

/** Three weeks from 2026-07-15. The client's today, 07-22 (position 7), is the
 *  first editable day, so week 1 is history. The block ends 08-01 (position
 *  17): the read lays nothing on the last three days, which the grid greys. */
function makePlanForEditing(overrides: Partial<PlanForEditing> = {}): PlanForEditing {
  return {
    plan: {
      id: "plan-1",
      name: "PPL Block",
      splitType: "Push/Pull",
      effectiveFrom: PLAN_START,
      effectiveUntil: "2026-08-04",
    },
    clientToday: "2026-07-22",
    firstEditableDate: "2026-07-22",
    limit: { endsOn: "2026-08-01", source: "block" },
    days: Array.from({ length: 21 }, (_, i): PlanEditDay => ({
      date: addDaysToDateString(PLAN_START, i),
      sessions: holdsSession(i)
        ? [
            {
              eventId: eventAt(i),
              name: `Session ${i}`,
              focus: "strength",
              estimatedDurationMinutes: null,
              notes: null,
              calorieSurplusPercentage: 15,
              groups: [],
            },
          ]
        : [],
    })),
    version: "v-1",
    ...overrides,
  };
}

// Real SWR on its default cache, as the app runs it: the editor's read drops
// its entry when the editor unmounts, so every render reads the plan anew.
function renderPlaced(onSaved?: () => Promise<void>) {
  return render(
    <ProgramDraftProvider
      placedPlanId="plan-1"
      target="placed-plan"
      clientId="client-1"
      clientName="Casey Client"
      onSaved={onSaved}
    >
      <ProgramBuilder />
    </ProgramDraftProvider>,
  );
}

const editGets = () => fetchCalls.filter((c) => c.url === EDIT_URL && c.method === "GET");
const editPuts = () => fetchCalls.filter((c) => c.url === EDIT_URL && c.method === "PUT");

type PlanEditPutBody = {
  days: Array<{ sessions: Array<{ eventId: string | null; name: string }> }>;
  plan: { name: string; splitType: string | null };
  version: string;
};

const openEditor = () => screen.findByRole("button", { name: "Save changes to plan" });

/** Rename the plan — the identity input commits on blur. */
function renamePlan(name: string) {
  const nameInput = screen.getByLabelText("Program name");
  fireEvent.change(nameInput, { target: { value: name } });
  fireEvent.blur(nameInput);
}

/** Remove a session from its day with its card's X. */
function removeSession(name: string) {
  fireEvent.click(
    within(screen.getByLabelText(`Open session ${name}`)).getByLabelText("Remove session"),
  );
}

/** The rail save icon, then the confirm's Confirm. */
async function saveAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Save changes to plan" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
}

describe("ProgramBuilder placed-plan target (the plan editor)", () => {
  beforeEach(() => {
    cleanup();
    fetchCalls.length = 0;
    editStatus = 200;
    planFixture = null; // useSavedPlan is disabled for this target
    planEditFixture = makePlanForEditing();
    toastSpy.success.mockClear();
    toastSpy.error.mockClear();
  });

  it("reads the plan once and fills the overlay box (h-full) — never the library's shell-cancelling negative margins", async () => {
    const { container } = renderPlaced();
    await openEditor();
    expect(editGets()).toHaveLength(1);
    const root = container.firstElementChild as HTMLElement;
    // The -mx-8 shift exists to cancel the programs shell's padding; inside
    // the full-screen overlay it slides the editor over the nav rail and
    // pushes Day 7 off screen.
    expect(root.className).toContain("h-full");
    expect(root.className).not.toContain("-mx-8");
  });

  it("shows the plan editor's chrome: the save icon, no library commit, a calendar back label, a renamable plan", async () => {
    renderPlaced();
    expect(await openEditor()).toBeInTheDocument();
    expect(screen.queryByLabelText("Save program")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete program")).not.toBeInTheDocument();
    expect(screen.queryByText("Apply to client")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Back to calendar")).toBeInTheDocument();
    // Opens straight into edit mode with the plan's name live.
    expect(screen.getByLabelText("Program name")).toHaveValue("PPL Block");
    // No default-surplus pill: placement resolved the default into every row
    // (absolute surplus), so the header knob would be dead — hidden instead.
    expect(
      screen.queryByLabelText("Default calorie surplus percent"),
    ).not.toBeInTheDocument();
  });

  it("renders the history days inert and leaves the editable days their affordances", async () => {
    renderPlaced();
    await openEditor();
    // Week 1's three sessions carry the lock marker ...
    expect(screen.getAllByTitle(PAST_LOCKED)).toHaveLength(3);
    // ... and only the five editable sessions (days 7, 9, 11, 14, 16) remove.
    expect(screen.getAllByLabelText("Remove session")).toHaveLength(5);
    // Only the editable rest days (8, 10, 12, 13, 15, 17) offer an add.
    expect(screen.getAllByLabelText(/^Add session to day/)).toHaveLength(6);
  });

  it("greys the days past the block's end and says why", async () => {
    const { container } = renderPlaced();
    await openEditor();
    expect(
      screen.getByText("This block ends 1 Aug. Days after it are greyed out."),
    ).toBeInTheDocument();
    // Days 18-20 are greyed, and carry no Rest label: 4 history + 6 editable.
    expect(container.getElementsByClassName("bg-[rgba(147,176,180,0.12)]")).toHaveLength(3);
    expect(screen.getAllByText("Rest")).toHaveLength(10);
  });

  it("rings the client's today", async () => {
    const { container } = renderPlaced();
    await openEditor();
    const ringed = container.getElementsByClassName("ring-1 ring-[#0d9488]");
    expect(ringed).toHaveLength(1);
    expect(ringed[0]).toBe(screen.getByLabelText("Open session Session 7"));
  });

  it("disables Add week when the next week would start past the limit", async () => {
    renderPlaced();
    await openEditor();
    expect(screen.getByRole("button", { name: "Add week" })).toBeDisabled();
    cleanup();

    // The next program starts 11 Aug: a fourth week, from 5 Aug, still starts
    // inside the limit.
    planEditFixture = makePlanForEditing({
      limit: { endsOn: "2026-08-10", source: "next_plan" },
    });
    renderPlaced();
    await openEditor();
    expect(
      screen.getByText("The next program starts 11 Aug. Days from then are greyed out."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add week" })).not.toBeDisabled();
  });

  it("keeps save disabled until an edit, then confirms and PUTs the grid, the plan's name and focus, and the version", async () => {
    renderPlaced();
    const saveBtn = await openEditor();
    expect(saveBtn).toBeDisabled();

    renamePlan("PPL Block v2");
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);
    expect(
      await screen.findByRole("dialog", { name: "Confirm updated plan" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // Nothing is sent before the confirm.
    expect(editPuts()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(editPuts()).toHaveLength(1));

    const body = editPuts()[0].body as PlanEditPutBody;
    expect(Object.keys(body).sort()).toEqual(["days", "plan", "version"]);
    expect(body.plan).toEqual({ name: "PPL Block v2", splitType: "Push/Pull" });
    expect(body.version).toBe("v-1");
    expect(body.days).toHaveLength(21);
    body.days.forEach((day, i) => {
      // Each session read from the calendar claims its entry.
      expect(day.sessions).toEqual(
        holdsSession(i) ? [expect.objectContaining({ eventId: eventAt(i), name: `Session ${i}` })] : [],
      );
    });
    await waitFor(() => expect(toastSpy.success).toHaveBeenCalledWith("Plan updated"));
    // With no host waiting on the save, the confirm closes on a clean tree.
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Confirm updated plan" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Save changes to plan" })).toBeDisabled();
  });

  it("waits on the host's onSaved: the confirm stays up, saving, until it resolves", async () => {
    let finishSaved!: () => void;
    const saved = new Promise<void>((resolve) => {
      finishSaved = resolve;
    });
    const onSaved = vi.fn(() => saved);
    renderPlaced(onSaved);
    await openEditor();
    renamePlan("PPL Block v2");
    await saveAndConfirm();

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog", { name: "Confirm updated plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();

    await act(async () => {
      finishSaved();
      await saved;
    });
    // The save ends with onSaved; the host closes the editor with the confirm
    // still on it.
    expect(screen.getByRole("button", { name: "Confirm" })).not.toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Confirm updated plan" })).toBeInTheDocument();
  });

  it("a 409 swaps the confirm for the refusal and keeps the draft for another save", async () => {
    editStatus = 409;
    renderPlaced();
    await openEditor();
    renamePlan("PPL Block v2");
    await saveAndConfirm();

    expect(
      await screen.findByRole("dialog", { name: "This plan changed while you were editing" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Confirm updated plan" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload and discard edits" })).toBeInTheDocument();
    expect(toastSpy.success).not.toHaveBeenCalled();

    // "Keep editing" dismisses without touching the tree: it is still dirty.
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "This plan changed while you were editing" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Save changes to plan" })).not.toBeDisabled();

    // The next save still carries the edit.
    editStatus = 200;
    await saveAndConfirm();
    await waitFor(() => expect(editPuts()).toHaveLength(2));
    expect((editPuts()[1].body as PlanEditPutBody).plan.name).toBe("PPL Block v2");
  });

  it("a reload shows the plan's name as it was read, not the discarded rename", async () => {
    editStatus = 409;
    renderPlaced();
    await openEditor();
    renamePlan("PPL Block v2");
    await saveAndConfirm();
    await screen.findByRole("dialog", { name: "This plan changed while you were editing" });

    planEditFixture = makePlanForEditing({ version: "v-2" });
    fireEvent.click(screen.getByRole("button", { name: "Reload and discard edits" }));

    await waitFor(() => expect(screen.getByLabelText("Program name")).toHaveValue("PPL Block"));
  });

  it("Discard changes shows the plan's name as it was read again", async () => {
    renderPlaced();
    await openEditor();
    renamePlan("PPL Block v2");
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(screen.getByLabelText("Program name")).toHaveValue("PPL Block"));
  });

  it("Reload and discard edits reads the plan again and re-seeds the editor from it", async () => {
    editStatus = 409;
    renderPlaced();
    await openEditor();
    removeSession("Session 9");
    expect(screen.queryByText("Session 9")).not.toBeInTheDocument();
    await saveAndConfirm();
    await screen.findByRole("dialog", { name: "This plan changed while you were editing" });

    // The calendar moved on: day 11's session was renamed elsewhere.
    const latest = makePlanForEditing({ version: "v-2" });
    latest.days = latest.days.map((day, i) =>
      i === 11
        ? { ...day, sessions: day.sessions.map((s) => ({ ...s, name: "Session 11 (moved)" })) }
        : day,
    );
    planEditFixture = latest;
    fireEvent.click(screen.getByRole("button", { name: "Reload and discard edits" }));

    await waitFor(() => expect(screen.getByText("Session 11 (moved)")).toBeInTheDocument());
    expect(editGets()).toHaveLength(2);
    // The discarded edit is gone: Session 9 is back.
    expect(screen.getByText("Session 9")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "This plan changed while you were editing" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Save changes to plan" })).toBeDisabled();

    // The next save sends the version of the plan it re-read.
    editStatus = 200;
    removeSession("Session 9");
    await saveAndConfirm();
    await waitFor(() => expect(editPuts()).toHaveLength(2));
    expect((editPuts()[1].body as PlanEditPutBody).version).toBe("v-2");
  });
});

describe("ProgramBuilder placed-plan target — a day holding several sessions", () => {
  beforeEach(() => {
    cleanup();
    fetchCalls.length = 0;
    editStatus = 200;
    planFixture = null;
    toastSpy.success.mockClear();
    toastSpy.error.mockClear();
  });

  // Day 9 holds an evening session after Session 9, from its own entry.
  function twoADayRead(): PlanForEditing {
    const read = makePlanForEditing();
    read.days = read.days.map((day, i) =>
      i === 9
        ? {
            ...day,
            sessions: [
              ...day.sessions,
              { ...day.sessions[0], eventId: eventAt(9, 2), name: "Session 9 PM", calorieSurplusPercentage: 5 },
            ],
          }
        : day,
    );
    return read;
  }

  const sheet = () => screen.getByTestId("session-sheet");

  it("shows every session on the day, in order, and counts sessions — not days — in the header and the week", async () => {
    planEditFixture = twoADayRead();
    renderPlaced();
    await openEditor();
    expect(
      screen.getAllByLabelText(/^Open session Session 9/).map((card) => card.getAttribute("aria-label")),
    ).toEqual(["Open session Session 9", "Open session Session 9 PM"]);
    expect(screen.getByText("3 weeks · 9 sessions")).toBeInTheDocument();
    // Week 2 holds four sessions on three days.
    expect(screen.getByText("4×")).toBeInTheDocument();
  });

  it("opens each session of the day in the editor sheet on its own", async () => {
    planEditFixture = twoADayRead();
    renderPlaced();
    await openEditor();
    fireEvent.click(screen.getByLabelText("Open session Session 9 PM"));
    expect(sheet()).toHaveAttribute("data-open", "true");
    expect(sheet()).toHaveAttribute("data-session", "Session 9 PM");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByLabelText("Open session Session 9"));
    expect(sheet()).toHaveAttribute("data-session", "Session 9");
  });

  it("saves a day holding two sessions with both, in order, each claiming its entry", async () => {
    planEditFixture = twoADayRead();
    renderPlaced();
    await openEditor();
    renamePlan("PPL Block v2");
    await saveAndConfirm();

    await waitFor(() => expect(editPuts()).toHaveLength(1));
    const body = editPuts()[0].body as PlanEditPutBody;
    expect(body.days[9].sessions).toEqual([
      expect.objectContaining({ eventId: eventAt(9), name: "Session 9" }),
      expect.objectContaining({ eventId: eventAt(9, 2), name: "Session 9 PM", calorieSurplusPercentage: 5 }),
    ]);
    expect(body.days.flatMap((day) => day.sessions)).toHaveLength(9);
  });

  it("removes one session with its X — the day keeps the other, and the save sends it alone", async () => {
    planEditFixture = twoADayRead();
    renderPlaced();
    await openEditor();
    removeSession("Session 9");
    expect(screen.queryByLabelText("Open session Session 9")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Open session Session 9 PM")).toBeInTheDocument();
    expect(screen.getByText("3 weeks · 8 sessions")).toBeInTheDocument();

    await saveAndConfirm();
    await waitFor(() => expect(editPuts()).toHaveLength(1));
    const body = editPuts()[0].body as PlanEditPutBody;
    expect(body.days[9].sessions).toEqual([
      expect.objectContaining({ eventId: eventAt(9, 2), name: "Session 9 PM" }),
    ]);
  });

  it("closes a session's open sheet when that session is removed, and keeps the day's other one", async () => {
    planEditFixture = twoADayRead();
    renderPlaced();
    await openEditor();
    fireEvent.click(screen.getByLabelText("Open session Session 9 PM"));
    expect(sheet()).toHaveAttribute("data-open", "true");

    // An assistant op or any other writer removing it: here, its card's X.
    removeSession("Session 9 PM");
    expect(sheet()).toHaveAttribute("data-open", "false");
    expect(screen.getByLabelText("Open session Session 9")).toBeInTheDocument();
  });
});
