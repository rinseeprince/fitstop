import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PlanForEditing } from "@/services/plan-edit-service";
import type { ProgramDraft } from "./program-builder-types";
import type { ProgramBuilderState } from "./use-program-builder-state";

vi.mock("@/hooks/use-plan-edit", () => ({
  usePlanEdit: vi.fn(),
}));

import { usePlanEdit } from "@/hooks/use-plan-edit";
import { usePlacedPlanSource } from "./use-placed-plan-source";

const mockUsePlanEdit = vi.mocked(usePlanEdit);

type PlanEditResponse = { success: boolean; data: PlanForEditing };

/** A one-week plan from 2026-07-15; today (07-17) is its first editable day
 *  and its block ends on its last day. Day 3 (07-17) holds a morning and an
 *  evening session. */
function makeRead(version: string, planName = "PPL Block"): PlanForEditing {
  return {
    plan: {
      id: "plan-1",
      name: planName,
      splitType: null,
      effectiveFrom: "2026-07-15",
      effectiveUntil: "2026-07-21",
    },
    clientToday: "2026-07-17",
    firstEditableDate: "2026-07-17",
    limit: { endsOn: "2026-07-21", source: "block" },
    days: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-07-${15 + i}`,
      sessions:
        i === 2
          ? [readSession(`${version}-am`, "AM run"), readSession(`${version}-pm`, "PM lift")]
          : [],
    })),
    version,
  };
}

function readSession(eventId: string, name: string) {
  return {
    eventId,
    name,
    focus: null,
    estimatedDurationMinutes: null,
    notes: null,
    calorieSurplusPercentage: null,
    groups: [],
  };
}

/** The seeded draft's day-3 session uids, each with the entry it was read from. */
function entriesOf(draft: ProgramDraft | null, sessionEvents: Readonly<Record<string, string>>) {
  return (draft?.weeks[0].days[2].sessions ?? []).map((s) => sessionEvents[s.uid]);
}

// Mutable harness standing in for useProgramBuilderState: the source hook only
// reads draft/seed, and seed() lands the next render's draft.
function makeHarness() {
  const box = { draft: null as ProgramDraft | null };
  const seed = vi.fn((next: ProgramDraft) => {
    box.draft = next;
  });
  const setMode = vi.fn();
  const mutate = vi.fn<() => Promise<PlanEditResponse | undefined>>();
  const stateFor = () => ({ draft: box.draft, seed }) as unknown as ProgramBuilderState;
  return { box, seed, setMode, mutate, stateFor };
}

type SourceOptions = { enabled?: boolean; error?: unknown; isLoading?: boolean };

function renderSource(
  h: ReturnType<typeof makeHarness>,
  read: PlanForEditing | null,
  { enabled = true, error = null, isLoading = false }: SourceOptions = {},
) {
  let current = read;
  mockUsePlanEdit.mockImplementation(() => ({
    planForEditing: current,
    isLoading,
    error,
    mutate: h.mutate,
  }));
  const hook = renderHook(() =>
    usePlacedPlanSource({
      enabled,
      clientId: "client-1",
      placedPlanId: "plan-1",
      state: h.stateFor(),
      setMode: h.setMode,
    }),
  );
  return {
    ...hook,
    setRead(next: PlanForEditing) {
      current = next;
      hook.rerender();
    },
  };
}

describe("usePlacedPlanSource", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds once when the read arrives, and opens in edit mode", () => {
    const h = makeHarness();
    const view = renderSource(h, null);
    expect(mockUsePlanEdit).toHaveBeenCalledWith("client-1", "plan-1");
    expect(h.seed).not.toHaveBeenCalled();
    expect(view.result.current.version).toBeNull();

    view.setRead(makeRead("v-1"));
    expect(h.seed).toHaveBeenCalledTimes(1);
    expect(h.seed.mock.calls[0][0].name).toBe("PPL Block");
    expect(h.setMode).toHaveBeenCalledWith("edit");
    // What the seed brought with it.
    expect(view.result.current).toMatchObject({
      editableDays: { from: 2, through: 6 },
      todayPosition: 2,
      limit: { endsOn: "2026-07-21", source: "block" },
      version: "v-1",
    });

    view.rerender();
    expect(h.seed).toHaveBeenCalledTimes(1);
  });

  it("holds each seeded session's calendar entry by its draft uid, set with the version", () => {
    const h = makeHarness();
    const view = renderSource(h, null);
    expect(view.result.current.sessionEvents).toEqual({});

    view.setRead(makeRead("v-1"));
    expect(entriesOf(h.box.draft, view.result.current.sessionEvents)).toEqual(["v-1-am", "v-1-pm"]);
    expect(Object.keys(view.result.current.sessionEvents)).toHaveLength(2);
  });

  it("a later read never re-seeds the draft that is there", () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("v-1"));
    expect(h.seed).toHaveBeenCalledTimes(1);

    view.setRead(makeRead("v-2", "Changed elsewhere"));
    expect(h.seed).toHaveBeenCalledTimes(1);
    expect(h.box.draft?.name).toBe("PPL Block");
    // The held version stays the one the draft was built from.
    expect(view.result.current.version).toBe("v-1");
  });

  it("discard re-seeds from the current read", () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("v-1"));
    view.setRead(makeRead("v-2", "Current read"));
    h.setMode.mockClear();

    act(() => view.result.current.discard());
    expect(h.seed).toHaveBeenCalledTimes(2);
    expect(h.seed.mock.calls[1][0].name).toBe("Current read");
    expect(view.result.current.version).toBe("v-2");
    // The re-seed mints new uids: the entries are held under those.
    expect(entriesOf(h.box.draft, view.result.current.sessionEvents)).toEqual(["v-2-am", "v-2-pm"]);
    expect(h.setMode).toHaveBeenCalledWith("edit");
  });

  it("reload waits for the re-read, then re-seeds from it", async () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("v-1"));
    let land!: (response: PlanEditResponse) => void;
    h.mutate.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );

    let reloading!: Promise<void>;
    act(() => {
      reloading = view.result.current.reload();
    });
    expect(h.mutate).toHaveBeenCalledTimes(1);
    // Nothing re-seeds before the read lands.
    expect(h.seed).toHaveBeenCalledTimes(1);

    await act(async () => {
      land({ success: true, data: makeRead("v-2", "Fresh read") });
      await reloading;
    });
    expect(h.seed).toHaveBeenCalledTimes(2);
    expect(h.seed.mock.calls[1][0].name).toBe("Fresh read");
    expect(view.result.current.version).toBe("v-2");
  });

  it("refreshVersion takes the fresh version and keeps the draft", async () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("v-1"));
    const seeded = h.box.draft;
    h.mutate.mockResolvedValue({
      success: true,
      data: { ...makeRead("v-2", "Fresh read"), firstEditableDate: "2026-07-18" },
    });

    const entries = view.result.current.sessionEvents;
    await act(async () => {
      await view.result.current.refreshVersion();
    });
    expect(view.result.current.version).toBe("v-2");
    expect(h.seed).toHaveBeenCalledTimes(1);
    expect(h.box.draft).toBe(seeded);
    // The kept draft's sessions keep the entries the seed brought.
    expect(view.result.current.sessionEvents).toBe(entries);
    // Only the version moves: the days the draft was built on stay.
    expect(view.result.current.editableDays).toEqual({ from: 2, through: 6 });
  });

  it("loadError is the server's sentence when it sent one, else the generic one", () => {
    const serverSaid = renderSource(makeHarness(), null, {
      error: Object.assign(new Error("API request failed"), {
        status: 404,
        info: { error: "This plan has ended and can't be edited." },
      }),
    });
    expect(serverSaid.result.current.loadError).toBe("This plan has ended and can't be edited.");
    serverSaid.unmount();

    const noSentence = renderSource(makeHarness(), null, {
      error: Object.assign(new Error("API request failed"), { status: 500, info: {} }),
    });
    expect(noSentence.result.current.loadError).toBe("This plan couldn't be loaded for editing");
    noSentence.unmount();

    const network = renderSource(makeHarness(), null, { error: new TypeError("Failed to fetch") });
    expect(network.result.current.loadError).toBe("This plan couldn't be loaded for editing");
  });

  it("disabled, it keys no read and reports nothing", () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("v-1"), {
      enabled: false,
      error: new Error("API request failed"),
      isLoading: true,
    });
    expect(mockUsePlanEdit).toHaveBeenCalledWith(null, null);
    expect(h.seed).not.toHaveBeenCalled();
    expect(view.result.current).toMatchObject({
      isLoading: false,
      loadError: null,
      editableDays: null,
      version: null,
    });
  });
});
