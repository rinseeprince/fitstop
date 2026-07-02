import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ProgramBuilder } from "./program-builder";
import { ProgramDraftProvider } from "./program-draft-provider";
import type { SavedPlan, SavedSession } from "@/types/training";

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
  });

  it("Save program posts the whole tree (surplus 0 preserved), PATCHes duration, promotes, then leaves edit mode", async () => {
    render(
      <ProgramDraftProvider savedPlanId="plan-1" target="library">
        <ProgramBuilder />
      </ProgramDraftProvider>,
    );
    fireEvent.click(screen.getByLabelText("Save program"));

    await waitFor(() => expect(screen.getByLabelText("Edit program")).toBeInTheDocument());

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
    // Still in edit mode — Save stays available for the rename-and-retry.
    expect(screen.getByLabelText("Save program")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit program")).toBeNull();
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
    // No promote attempt, no mode flip, grid content intact.
    expect(promoteCall()).toBeUndefined();
    expect(screen.getByLabelText("Save program")).toBeInTheDocument();
    expect(screen.getByText("Push")).toBeInTheDocument();
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
