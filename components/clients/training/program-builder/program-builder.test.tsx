import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ProgramBuilder } from "./program-builder";
import { ProgramDraftProvider } from "./program-draft-provider";
import type { SavedPlan, SavedSession } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";

// -- mocks --------------------------------------------------------------------

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Toast spy so the save-as-workout flow can assert the deduped-name copy.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const mutateMock = vi.fn(() => Promise.resolve(undefined));
let planFixture: SavedPlan | null = null;
vi.mock("@/hooks/use-saved-plan", () => ({
  useSavedPlan: () => ({ plan: planFixture, isLoading: false, mutate: mutateMock }),
}));

// Placed-plan target: the amendment GET feeding usePlacedPlanSource.
let placedPlanFixture: unknown = null;
const placedMutateMock = vi.fn(() => Promise.resolve(placedPlanFixture));
vi.mock("@/hooks/use-placed-plan", () => ({
  usePlacedPlan: (clientId: string | null, planId: string | null) => ({
    placedPlan: clientId && planId ? placedPlanFixture : null,
    isLoading: false,
    error: null,
    mutate: placedMutateMock,
  }),
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

type FetchCall = { url: string; method: string; body: unknown };
const fetchCalls: FetchCall[] = [];
let promoteStatus = 200;
let overwriteStatus = 200;
let amendStatus = 200;

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
    if (u.endsWith("/amendment") && init?.method === "PUT") {
      return Promise.resolve(
        jsonResponse(
          amendStatus,
          amendStatus === 200
            ? { success: true, floor: "2026-07-22", offset: 7, eventsCreated: 3 }
            : { error: "This plan changed while you were editing" },
        ),
      );
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
    toastSpy.mockClear();
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
        exercises: unknown[];
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
    expect(body.sessions.slice(1).every((s) => s.isRest && s.exercises.length === 0)).toBe(true);

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
    plan.sessions[0].exercises = [
      {
        id: "ex-row-1",
        savedSessionId: "s-0",
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
        supersetGroup: null,
        isWarmup: false,
        notes: null,
        setSpecs: benchSpecs.map((s) => ({ ...s })),
        videoUrl: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
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
        exercises: Array<{ setSpecs: Array<{ set_type?: string; load_value?: number }> | null }>;
      }>;
    };
    expect(body.sessions).toHaveLength(14);
    const week0Push = body.sessions.find((s) => s.weekIndex === 0 && !s.isRest)!;
    const week1Push = body.sessions.find((s) => s.weekIndex === 1 && !s.isRest)!;
    // Week 0 serializes byte-identical to the fixture prescription.
    expect(week0Push.exercises[0].setSpecs).toEqual(benchSpecs);
    // Week 1 carries the progressed working loads; warm-up untouched.
    expect(week1Push.exercises[0].setSpecs!.map((s) => s.load_value)).toEqual([
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
      exercises: [],
    });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("Push (copy)"),
        }),
      ),
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
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("Push (copy)"),
        }),
      ),
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

describe("ProgramBuilder client-draft mode (Phase 5)", () => {
  beforeEach(() => {
    cleanup();
    fetchCalls.length = 0;
    // A saved library template — the client editor opens it in view mode.
    planFixture = { ...makeDraftPlan(), status: "saved" };
    mutateMock.mockClear();
    pushMock.mockClear();
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
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Placed-plan target (Job 2): the amendment surface's chrome + save flow.
// ═════════════════════════════════════════════════════════════════════════════

const isTrainingPos = (i: number) => i % 7 === 0 || i % 7 === 2 || i % 7 === 4;

function placedDate(position: number): string {
  const d = new Date("2026-07-15T00:00:00");
  d.setDate(d.getDate() + position);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A 2-week placed read: effective 2026-07-15, client today 2026-07-22 →
 *  week 1 elapsed (locked), week 2 open. */
function makePlacedRead() {
  return {
    plan: {
      id: "plan-1",
      name: "PPL Block",
      splitType: "Push/Pull",
      programDurationWeeks: 2,
      frequencyPerWeek: 3,
      effectiveFrom: "2026-07-15",
      phaseId: null,
      savedPlanId: null,
      status: "active",
      updatedAt: "2026-07-20T00:00:00Z",
    },
    clientToday: "2026-07-22",
    windowEnd: "2026-07-28",
    isFullyPast: false,
    amendmentToken: "tok-1",
    sessions: Array.from({ length: 14 }, (_, i) => ({
      id: `cur-${i}`,
      name: isTrainingPos(i) ? `Session ${i}` : "Rest",
      focus: isTrainingPos(i) ? "strength" : null,
      weekIndex: Math.floor(i / 7),
      orderIndex: i,
      isRest: !isTrainingPos(i),
      estimatedDurationMinutes: null,
      calorieSurplusPercentage: isTrainingPos(i) ? 15 : null,
      notes: null,
      sessionType: "training",
      createdAt: "2026-07-15T00:00:00Z",
      exercises: [],
      events: [
        // Week-1 training days completed; week-2 still scheduled.
        {
          id: `ev-${i}`,
          date: placedDate(i),
          status: i < 7 ? "completed" : "scheduled",
          isModified: false,
        },
      ].filter(() => isTrainingPos(i)),
    })),
    futureModifiedEvents: [
      { id: "ev-9", date: "2026-07-24", sessionName: "Session 9" },
    ],
  };
}

function renderPlaced() {
  return render(
    <ProgramDraftProvider
      placedPlanId="plan-1"
      target="placed-plan"
      clientId="client-1"
      clientName="Casey Client"
    >
      <ProgramBuilder />
    </ProgramDraftProvider>,
  );
}

const amendPut = () =>
  fetchCalls.find((c) => c.url.endsWith("/amendment") && c.method === "PUT");

describe("ProgramBuilder placed-plan target", () => {
  beforeEach(() => {
    cleanup();
    fetchCalls.length = 0;
    amendStatus = 200;
    planFixture = null; // useSavedPlan is disabled for this target
    placedPlanFixture = makePlacedRead();
    toastSpy.mockClear();
    placedMutateMock.mockClear();
  });

  it("fills the overlay box (h-full) — never the library's shell-cancelling negative margins", async () => {
    const { container } = renderPlaced();
    await screen.findByRole("button", { name: "Save changes to plan" });
    const root = container.firstElementChild as HTMLElement;
    // The -mx-8 shift exists to cancel the programs shell's padding; inside
    // the full-screen overlay it slides the editor over the nav rail and
    // pushes Day 7 off screen (owner smoke finding).
    expect(root.className).toContain("h-full");
    expect(root.className).not.toContain("-mx-8");
  });

  it("shows the amendment chrome: save-changes present, library commit absent, calendar back label", async () => {
    renderPlaced();
    expect(
      await screen.findByRole("button", { name: "Save changes to plan" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Save program")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete program")).not.toBeInTheDocument();
    expect(screen.queryByText("Apply to client")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Back to calendar")).toBeInTheDocument();
    // Opens straight into edit mode: the identity input is live.
    expect(screen.getByLabelText("Program name")).toBeInTheDocument();
    // No default-surplus pill: placement resolved the default into every row
    // (absolute surplus), so the header knob would be dead — hidden instead.
    expect(
      screen.queryByLabelText("Default calorie surplus percent"),
    ).not.toBeInTheDocument();
  });

  it("save is disabled until dirty, then PUTs the grid + token + identity patch through the confirm", async () => {
    renderPlaced();
    const saveBtn = await screen.findByRole("button", { name: "Save changes to plan" });
    expect(saveBtn).toBeDisabled();

    // The identity input commits on blur (uncontrolled).
    const nameInput = screen.getByLabelText("Program name");
    fireEvent.change(nameInput, { target: { value: "PPL Block v2" } });
    fireEvent.blur(nameInput);
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);
    // Confirm dialog with the moved-events warning list.
    expect(await screen.findByText("Save changes to this plan?")).toBeInTheDocument();
    expect(screen.getByText(/manually-moved upcoming session/)).toBeInTheDocument();
    // The moved session is named in the dialog list (it also renders in the
    // grid behind the dialog, hence All).
    expect(screen.getAllByText("Session 9").length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(amendPut()).toBeDefined());

    const body = amendPut()!.body as {
      expectedToken: string;
      plan?: { name?: string };
      sessions: Array<{ orderIndex: number; weekIndex?: number; isRest: boolean }>;
    };
    expect(body.expectedToken).toBe("tok-1");
    expect(body.plan?.name).toBe("PPL Block v2");
    expect(body.sessions).toHaveLength(14);
    body.sessions.forEach((s, i) => {
      expect(s.orderIndex).toBe(i);
      expect(s.weekIndex).toBe(Math.floor(i / 7));
    });
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Plan updated" }),
      ),
    );
    // A clean save revalidates the shared amendment-GET cache so the next
    // editor open can't seed the pre-save snapshot and self-409.
    expect(placedMutateMock).toHaveBeenCalled();
  });

  it("a 409 opens the drift dialog and keeps the draft", async () => {
    amendStatus = 409;
    renderPlaced();
    const nameInput = await screen.findByLabelText("Program name");
    fireEvent.change(nameInput, { target: { value: "PPL Block v2" } });
    fireEvent.blur(nameInput);
    fireEvent.click(screen.getByRole("button", { name: "Save changes to plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("This plan changed while you were editing"),
    ).toBeInTheDocument();
    // Draft intact — the edited name survived and the tree is still dirty.
    expect(screen.getByLabelText("Program name")).toHaveValue("PPL Block v2");
    // "Keep editing" dismisses without touching the tree.
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() =>
      expect(
        screen.queryByText("This plan changed while you were editing"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Save changes to plan" }),
    ).not.toBeDisabled();
  });

  it("locked (elapsed) day cells render inert; future cells stay editable", async () => {
    renderPlaced();
    await screen.findByRole("button", { name: "Save changes to plan" });
    // Week-1 training cards carry the lock marker; week-2 cards don't.
    expect(screen.getAllByTitle("This day already happened")).toHaveLength(3);
    // Clear-X only on the 3 unlocked week-2 session cards.
    expect(screen.getAllByLabelText("Clear session (back to rest)")).toHaveLength(3);
  });
});
