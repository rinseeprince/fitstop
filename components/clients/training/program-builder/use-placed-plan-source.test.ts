import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { PlacedPlanForBuilder } from "@/services/plan-amendment-service";
import type { ProgramDraft } from "./program-builder-types";
import type { ProgramBuilderState } from "./use-program-builder-state";

vi.mock("@/hooks/use-placed-plan", () => ({
  usePlacedPlan: vi.fn(),
}));

import { usePlacedPlan } from "@/hooks/use-placed-plan";
import { usePlacedPlanSource } from "./use-placed-plan-source";

const mockUsePlacedPlan = vi.mocked(usePlacedPlan);

function makeRead(token: string, planName = "PPL Block"): PlacedPlanForBuilder {
  return {
    plan: {
      id: "plan-1",
      name: planName,
      splitType: null,
      programDurationWeeks: 1,
      frequencyPerWeek: 1,
      effectiveFrom: "2026-07-15",
      savedPlanId: null,
      status: "active",
      updatedAt: "2026-07-20T00:00:00Z",
    },
    clientToday: "2026-07-15", // nothing locked — locking isn't under test here
    windowEnd: "2026-07-21",
    isFullyPast: false,
    amendmentToken: token,
    sessions: Array.from({ length: 7 }, (_, i) => ({
      id: `cur-${i}`,
      name: "Rest",
      focus: null,
      weekIndex: 0,
      orderIndex: i,
      isRest: true,
      estimatedDurationMinutes: null,
      calorieSurplusPercentage: null,
      notes: null,
      sessionType: "training" as const,
      createdAt: "2026-07-15T00:00:00Z",
      exercises: [],
      events: [],
    })),
    futureModifiedEvents: [],
  };
}

// Mutable harness standing in for useProgramBuilderState: the source hook only
// reads draft/seed/isDirty, and seed() lands the next render's draft.
function makeHarness() {
  const box = { draft: null as ProgramDraft | null, isDirty: false };
  const seed = vi.fn((next: ProgramDraft) => {
    box.draft = next;
    box.isDirty = false;
  });
  const setMode = vi.fn();
  const mutate = vi.fn();
  const stateFor = () =>
    ({ draft: box.draft, seed, isDirty: box.isDirty }) as unknown as ProgramBuilderState;
  return { box, seed, setMode, mutate, stateFor };
}

describe("usePlacedPlanSource seeding", () => {
  beforeEach(() => vi.clearAllMocks());

  function renderSource(h: ReturnType<typeof makeHarness>, read: PlacedPlanForBuilder | null) {
    let current = read;
    mockUsePlacedPlan.mockImplementation(() => ({
      placedPlan: current,
      isLoading: false,
      error: null,
      mutate: h.mutate,
    }) as never);
    const hook = renderHook(() =>
      usePlacedPlanSource({
        enabled: true,
        clientId: "client-1",
        placedPlanId: "plan-1",
        state: h.stateFor(),
        setMode: h.setMode,
      }),
    );
    return {
      ...hook,
      setRead(next: PlacedPlanForBuilder) {
        current = next;
        hook.rerender();
      },
    };
  }

  it("seeds once from the first read and opens in edit mode", () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("tok-1"));
    view.rerender();
    expect(h.seed).toHaveBeenCalledTimes(1);
    expect(h.setMode).toHaveBeenCalledWith("edit");
    expect(view.result.current.amendmentToken).toBe("tok-1");
  });

  it("re-seeds when a FRESH read lands while the tree is pristine (stale-cache reopen)", () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("tok-stale", "Old Snapshot"));
    view.rerender(); // settle the initial (stale) seed
    expect(h.seed).toHaveBeenCalledTimes(1);

    // The mount revalidation arrives with the post-save state.
    view.setRead(makeRead("tok-fresh", "Saved Version"));
    view.rerender();
    expect(h.seed).toHaveBeenCalledTimes(2);
    expect(h.seed.mock.calls[1][0].name).toBe("Saved Version");
    expect(view.result.current.amendmentToken).toBe("tok-fresh");
  });

  it("never re-seeds over a dirty tree — edits win, drift becomes a 409 later", () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("tok-stale"));
    view.rerender();
    expect(h.seed).toHaveBeenCalledTimes(1);

    h.box.isDirty = true; // the coach started editing
    view.setRead(makeRead("tok-fresh"));
    view.rerender();
    expect(h.seed).toHaveBeenCalledTimes(1);
    // The held token stays the seeded one — the save layer owns refresh.
    expect(view.result.current.amendmentToken).toBe("tok-stale");
  });

  it("an unchanged read never re-seeds (SWR refreshes are no-ops)", () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("tok-1"));
    view.rerender();
    view.setRead(makeRead("tok-1"));
    view.rerender();
    expect(h.seed).toHaveBeenCalledTimes(1);
  });

  it("refreshToken updates the token WITHOUT re-seeding (kept-draft path)", async () => {
    const h = makeHarness();
    const view = renderSource(h, makeRead("tok-1"));
    view.rerender();
    h.box.isDirty = true; // kept-draft: mid-save edits stayed
    h.mutate.mockResolvedValue(makeRead("tok-2"));

    await view.result.current.refreshToken();
    view.rerender();

    expect(view.result.current.amendmentToken).toBe("tok-2");
    expect(h.seed).toHaveBeenCalledTimes(1); // the kept edits were not clobbered
  });
});
