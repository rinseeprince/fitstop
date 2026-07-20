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
    cycleLength: 7,
    restPattern: [1, 2, 3, 4, 5, 6],
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
    // Header: editable name + focus, and the redundant stat row is gone.
    expect(screen.getByLabelText("Program name")).toBeInTheDocument();
    expect(screen.getByLabelText("Program focus")).toBeInTheDocument();
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
    inlinePlan?: { name: string; sessions: unknown[] } | null;
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
    // Any edit dirties the draft; a rename commits on blur.
    const nameInput = screen.getByLabelText("Program name");
    fireEvent.change(nameInput, { target: { value: "Jane's Push/Pull" } });
    fireEvent.blur(nameInput);

    openApplyDialog();

    await waitFor(() =>
      expect(screen.getByTestId("apply-dialog")).toBeInTheDocument(),
    );
    const props = lastApplyProps()!;
    expect(props.inlinePlan).toBeTruthy();
    expect(props.inlinePlan!.name).toBe("Jane's Push/Pull");
    // Every slot serializes (rest rows included) — 7 for the one-week template.
    expect(props.inlinePlan!.sessions).toHaveLength(7);
    // Editing the client's copy never overwrites or deletes the library template.
    expect(fetchCalls.some((c) => c.url.endsWith("/overwrite"))).toBe(false);
    expect(fetchCalls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("Apply is reachable while dirty (the old draft-editor disabled it)", () => {
    renderClientDraft();
    fireEvent.click(screen.getByLabelText("Edit program"));
    const nameInput = screen.getByLabelText("Program name");
    fireEvent.change(nameInput, { target: { value: "Edited" } });
    fireEvent.blur(nameInput);
    expect(
      screen.getByRole("button", { name: "Apply to client" }),
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
