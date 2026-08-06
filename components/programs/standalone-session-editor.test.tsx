import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { StandaloneSessionEditor } from "./standalone-session-editor";
import type { SavedSession } from "@/types/training";
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
let fetchImpl: (url: string) => Promise<Response>;

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

function makeSavedSession(overrides: Partial<SavedSession> = {}): SavedSession {
  return {
    id: "s1",
    coachId: "coach-1",
    savedPlanId: null,
    name: "Push Day A",
    focus: "push",
    orderIndex: 0,
    weekIndex: 0,
    isRest: false,
    estimatedDurationMinutes: 45,
    calorieSurplusPercentage: 10,
    notes: null,
    sessionType: "training",
    exercises: [
      {
        id: "e1",
        savedSessionId: "s1",
        // Must be a real uuid — the client-side zod belt enforces it.
        exerciseId: "123e4567-e89b-12d3-a456-426614174000",
        name: "Bench Press",
        orderIndex: 0,
        sets: 1,
        repsMin: 5,
        repsMax: 8,
        repsTarget: null,
        rpeTarget: null,
        percentage1rm: null,
        tempo: null,
        restSeconds: 90,
        supersetGroup: null,
        isWarmup: false,
        notes: null,
        setSpecs: SPECS,
        videoUrl: "https://example.com/bench.mp4",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as SavedSession;
}

describe("StandaloneSessionEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];
    fetchImpl = () => Promise.resolve(jsonResponse(201, { success: true }));
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      fetchCalls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return fetchImpl(url);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("seeds create mode with an Untitled session and no exercises", () => {
    render(
      <StandaloneSessionEditor state={{ mode: "create" }} onClose={vi.fn()} />,
    );
    expect(screen.getByText("New session")).toBeDefined();
    expect(screen.getByDisplayValue("Untitled session")).toBeDefined();
    expect(screen.getByText(/No exercises yet/)).toBeDefined();
  });

  it("create save POSTs the payload and closes", async () => {
    const onClose = vi.fn();
    render(
      <StandaloneSessionEditor state={{ mode: "create" }} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save session" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/training/saved-sessions");
    expect(fetchCalls[0].method).toBe("POST");
    expect(fetchCalls[0].body).toMatchObject({
      name: "Untitled session",
      exercises: [],
    });
    // The editor's create keeps the coach's name verbatim — no dedupe flag.
    expect(fetchCalls[0].body).not.toHaveProperty("dedupeName");
  });

  it("edit save POSTs the overwrite endpoint preserving setSpecs and videoUrl", async () => {
    const onClose = vi.fn();
    render(
      <StandaloneSessionEditor
        state={{ mode: "edit", session: makeSavedSession() }}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("Edit session")).toBeDefined();
    expect(screen.getByDisplayValue("Push Day A")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // The ONLY network call is the standalone overwrite — nothing touches
    // any saved-plans endpoint (programs hold value-clones; structurally
    // unreachable from here).
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/training/saved-sessions/s1/overwrite");
    const body = fetchCalls[0].body as {
      exercises: Array<{ setSpecs: SetSpec[]; videoUrl: string }>;
    };
    expect(body.exercises[0].setSpecs).toEqual(SPECS);
    expect(body.exercises[0].videoUrl).toBe("https://example.com/bench.mp4");
  });

  it("cancel discards without any network call", () => {
    const onClose = vi.fn();
    render(
      <StandaloneSessionEditor
        state={{ mode: "edit", session: makeSavedSession() }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchCalls).toHaveLength(0);
  });

  it("shows the clone-by-value notice in edit mode only", () => {
    const { unmount } = render(
      <StandaloneSessionEditor
        state={{ mode: "edit", session: makeSavedSession() }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/keep their own copy/)).toBeDefined();
    unmount();
    render(
      <StandaloneSessionEditor state={{ mode: "create" }} onClose={vi.fn()} />,
    );
    expect(screen.queryByText(/keep their own copy/)).toBeNull();
  });

  it("gates dismissal while a save is in flight", async () => {
    let resolveFetch: (r: Response) => void = () => undefined;
    fetchImpl = () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    const onClose = vi.fn();
    render(
      <StandaloneSessionEditor state={{ mode: "create" }} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save session" }));
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    // Escape + Cancel are both dead while saving.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    resolveFetch(jsonResponse(201, { success: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("stays open and re-enables Save on failure", async () => {
    fetchImpl = () =>
      Promise.resolve(jsonResponse(500, { error: "Failed to save session" }));
    const onClose = vi.fn();
    render(
      <StandaloneSessionEditor state={{ mode: "create" }} onClose={onClose} />,
    );
    const save = screen.getByRole("button", { name: "Save session" });
    fireEvent.click(save);
    await waitFor(() => expect(save).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
    expect(fetchCalls).toHaveLength(1);
  });

  it("reseeds a fresh draft when reopened after editing", () => {
    const { rerender } = render(
      <StandaloneSessionEditor
        state={{ mode: "edit", session: makeSavedSession() }}
        onClose={vi.fn()}
      />,
    );
    // Mutate the local draft, then close and reopen in create mode.
    const nameInput = screen.getByDisplayValue("Push Day A");
    fireEvent.blur(nameInput, { target: { value: "Renamed locally" } });
    rerender(<StandaloneSessionEditor state={null} onClose={vi.fn()} />);
    rerender(
      <StandaloneSessionEditor state={{ mode: "create" }} onClose={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Untitled session")).toBeDefined();
    expect(screen.queryByDisplayValue("Renamed locally")).toBeNull();
  });

  it("clamps a legacy >100-char name at seed so the input shows what a save persists", () => {
    const longName = "L".repeat(150);
    render(
      <StandaloneSessionEditor
        state={{ mode: "edit", session: makeSavedSession({ name: longName }) }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("L".repeat(100))).toBeDefined();
    expect(screen.queryByDisplayValue(longName)).toBeNull();
  });

  it("survives StrictMode double-mounting without duplicate seeds", () => {
    render(
      <StrictMode>
        <StandaloneSessionEditor
          state={{ mode: "edit", session: makeSavedSession() }}
          onClose={vi.fn()}
        />
      </StrictMode>,
    );
    expect(screen.getByDisplayValue("Push Day A")).toBeDefined();
    // One exercise card, not two — the seed did not stack.
    expect(screen.getAllByText("Bench Press")).toHaveLength(1);
  });
});
