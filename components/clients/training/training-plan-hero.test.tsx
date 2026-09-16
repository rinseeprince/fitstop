import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { TrainingPlanHero } from "./training-plan-hero";
import type { ProgramDeleteTarget } from "./delete-program-dialog";

const ctx = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/contexts/training-builder-context", () => ({
  useTrainingBuilderContext: () => ctx.value,
}));
// The lines' own rules (Starts or Ends, the pencil, the bin's target, the move)
// are proved in plan-hero-line.test.tsx; here, which lines the hero asks for,
// with what — and the delete the hero owns. A stub's bin hands the hero a
// target the way the real one does.
const deleteTarget = vi.hoisted(() => ({
  value: null as ProgramDeleteTarget | null,
}));
vi.mock("./plan-hero-line", () => ({
  PlanHeroLine: (props: {
    clientId: string;
    kind: string;
    program: { id: string; name: string; startsOn: string; endsOn: string };
    clientToday: string;
    floor: string;
    onDelete: (target: ProgramDeleteTarget) => void;
  }) => (
    <p data-testid={`line-${props.kind}`}>
      {[props.clientId, props.program.id, props.program.name, props.program.startsOn, props.program.endsOn, props.clientToday, props.floor].join("|")}
      <button
        type="button"
        onClick={() =>
          props.onDelete(
            deleteTarget.value ?? {
              id: props.program.id,
              name: props.program.name,
              startsOn: props.program.startsOn,
              endsOn: props.program.endsOn,
              hasStarted: false,
              sessionsFrom: "today",
            },
          )
        }
      >
        {`bin-${props.kind}`}
      </button>
    </p>
  ),
}));
// Every screen the delete changes is refreshed through its own hook; the
// training one resolves when the test says so.
const refresh = vi.hoisted(() => ({
  invalidateTrainingData: vi.fn(),
  invalidateNutritionCalendar: vi.fn(),
  clearClientOverview: vi.fn(),
  clearAttentionFeed: vi.fn(),
  clearBlockFacts: vi.fn(),
}));
vi.mock("@/hooks/use-calendar-events", () => ({
  useInvalidateTrainingData: () => refresh.invalidateTrainingData,
}));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useInvalidateNutritionCalendar: () => refresh.invalidateNutritionCalendar,
}));
vi.mock("@/hooks/use-client-overview", () => ({
  useClearClientOverview: () => refresh.clearClientOverview,
}));
vi.mock("@/hooks/use-attention-feed", () => ({
  useClearAttentionFeed: () => refresh.clearAttentionFeed,
}));
vi.mock("@/components/clients/metrics/hooks/use-client-blocks", () => ({
  useClearBlockFacts: () => refresh.clearBlockFacts,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

function renderHero(props: Partial<Parameters<typeof TrainingPlanHero>[0]> = {}) {
  return render(<TrainingPlanHero clientId="client-1" {...props} />);
}

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> };
const answer = (status: number, body: unknown): FetchResult => ({
  ok: status < 400,
  status,
  json: () => Promise.resolve(body),
});

function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<FetchResult>>();

describe("TrainingPlanHero", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    deleteTarget.value = null;
    for (const hook of Object.values(refresh)) hook.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the empty branch with the library CTA in the lens-row register", () => {
    ctx.value = { plan: null };
    const onOpenGenerator = vi.fn();
    const { container } = renderHero({ onOpenGenerator });

    expect(screen.getByText("No active training plan")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Browse programs/ }),
    ).toBeInTheDocument();
    // Owner call: hero actions adopt the Exercise Data hero's lens-row design —
    // the primary is the active-lens teal chip, not a filled button.
    expect(container.innerHTML).toContain("rgba(13,148,136,0.15)");
    expect(container.innerHTML).not.toContain("0b7f75");
  });

  it("renders the plan branch as name + actions with no stat row (owner call)", () => {
    ctx.value = {
      plan: { id: "p1", name: "PPL", frequencyPerWeek: 4, programDurationWeeks: 8 },
    };
    renderHero({ onOpenGenerator: vi.fn() });

    expect(screen.getByText("PPL")).toBeInTheDocument();
    expect(screen.getByText("Training plan")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Apply program/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/adherence/)).toBeNull();
    expect(screen.queryByText(/this wk/)).toBeNull();
  });

  it("renders the Edit-plan primary only when onEditPlan is provided, and fires it", () => {
    ctx.value = { plan: { id: "p1", name: "PPL", frequencyPerWeek: 4 } };
    renderHero();
    expect(screen.queryByRole("button", { name: /Edit plan/ })).toBeNull();
    cleanup();

    const onEditPlan = vi.fn();
    renderHero({ onEditPlan });
    fireEvent.click(screen.getByRole("button", { name: /Edit plan/ }));
    expect(onEditPlan).toHaveBeenCalledTimes(1);
  });

  // The plan read answers with a running or a queued program, never an ended
  // one, so Edit plan has no state in which it is refused.
  it("never disables Edit plan, a queued program included", () => {
    ctx.value = {
      plan: { id: "p1", name: "PPL", frequencyPerWeek: 4, effectiveFrom: "2026-10-05", effectiveUntil: "2026-11-01" },
      nextPlan: null,
      clientToday: "2026-09-16",
      planStartFloor: "2026-09-16",
    };
    renderHero({ onEditPlan: vi.fn() });

    const button = screen.getByRole("button", { name: /Edit plan/ });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("title");
  });

  // Until the plan read answers — the first load, or a cleared entry
  // refetching after an apply or a delete — the hero is its own frame with
  // placeholders and claims nothing: neither the plan the context may still
  // carry nor its absence, and no action that would act on either.
  it("claims nothing while the plan read is pending, even with a plan still in hand", () => {
    ctx.value = {
      isPending: true,
      plan: { id: "p1", name: "PPL", frequencyPerWeek: 4, effectiveFrom: "2026-10-05", effectiveUntil: "2026-11-01" },
      nextPlan: { id: "p2", name: "Strength", effectiveFrom: "2026-11-02", effectiveUntil: "2026-11-15" },
      clientToday: "2026-09-16",
      planStartFloor: "2026-09-16",
    };
    const { container } = renderHero({ onOpenGenerator: vi.fn(), onEditPlan: vi.fn() });

    // The frame is there: the eyebrow and a placeholder in the title's slot.
    expect(screen.getByText("Training plan")).toBeInTheDocument();
    expect(container.querySelector("h2 [data-slot='skeleton']")).not.toBeNull();
    // Nothing claimed.
    expect(screen.queryByText("PPL")).toBeNull();
    expect(screen.queryByText("No active training plan")).toBeNull();
    expect(screen.queryByText(/Starts/)).toBeNull();
    expect(screen.queryByTestId("line-plan")).toBeNull();
    expect(screen.queryByTestId("line-next")).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit plan/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Apply program/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Browse programs/ })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("gives the start line the hero's program, the client's today and the floor", () => {
    ctx.value = {
      plan: { id: "p1", name: "Upper Lower", frequencyPerWeek: 4, effectiveFrom: "2026-09-28", effectiveUntil: "2026-10-25" },
      nextPlan: null,
      clientToday: "2026-09-16",
      planStartFloor: "2026-09-17",
    };
    renderHero();

    expect(screen.getByTestId("line-plan").textContent).toBe(
      "client-1|p1|Upper Lower|2026-09-28|2026-10-25|2026-09-16|2026-09-17bin-plan",
    );
    expect(screen.queryByTestId("line-next")).toBeNull();
  });

  it("gives the next line the program after the hero's one, under the start line", () => {
    ctx.value = {
      plan: { id: "p1", name: "Upper Lower", frequencyPerWeek: 4, effectiveFrom: "2026-08-31", effectiveUntil: "2026-10-04" },
      nextPlan: { id: "p2", name: "Strength", effectiveFrom: "2026-10-05", effectiveUntil: "2026-10-18" },
      clientToday: "2026-09-16",
      // The client has logged a workout today: the floor is tomorrow.
      planStartFloor: "2026-09-17",
    };
    renderHero();

    const start = screen.getByTestId("line-plan");
    const next = screen.getByTestId("line-next");
    expect(next.textContent).toBe("client-1|p2|Strength|2026-10-05|2026-10-18|2026-09-16|2026-09-17bin-next");
    expect(start.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("with no program there are no lines, even beside a next program", () => {
    ctx.value = {
      plan: null,
      nextPlan: { id: "p2", name: "Strength", effectiveFrom: "2026-10-05", effectiveUntil: "2026-10-18" },
      clientToday: "2026-09-16",
      planStartFloor: "2026-09-16",
    };
    renderHero({ onOpenGenerator: vi.fn() });

    expect(screen.queryByTestId("line-plan")).toBeNull();
    expect(screen.queryByTestId("line-next")).toBeNull();
  });

  describe("deleting one program", () => {
    const withPrograms = () => {
      ctx.value = {
        plan: { id: "p1", name: "Upper Lower", frequencyPerWeek: 4, effectiveFrom: "2026-08-31", effectiveUntil: "2026-10-04" },
        nextPlan: { id: "p2", name: "Strength", effectiveFrom: "2026-10-05", effectiveUntil: "2026-10-18" },
        clientToday: "2026-09-16",
        planStartFloor: "2026-09-16",
      };
    };
    const confirmButton = () => screen.getByRole("button", { name: /Remove plan|End plan/ });

    it("a line's bin opens the confirm on that program", () => {
      withPrograms();
      renderHero();
      fireEvent.click(screen.getByRole("button", { name: "bin-next" }));

      expect(screen.getByRole("heading", { name: "Remove plan?" })).toBeInTheDocument();
      expect(screen.getByRole("dialog").textContent).toContain("Removes Strength");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("deletes that program, and closes only once the Training tab has refetched", async () => {
      withPrograms();
      const response = deferred<FetchResult>();
      const trainingRefetch = deferred<undefined>();
      fetchMock.mockReturnValue(response.promise);
      refresh.invalidateTrainingData.mockReturnValue(trainingRefetch.promise);
      renderHero();

      fireEvent.click(screen.getByRole("button", { name: "bin-next" }));
      fireEvent.click(confirmButton());
      expect(fetchMock).toHaveBeenCalledWith("/api/clients/client-1/training/p2", { method: "DELETE" });

      await act(async () => {
        response.release(answer(200, { success: true }));
        await response.promise;
      });

      expect(refresh.invalidateNutritionCalendar).toHaveBeenCalledWith("client-1");
      expect(refresh.clearClientOverview).toHaveBeenCalledWith("client-1");
      expect(refresh.clearAttentionFeed).toHaveBeenCalledTimes(1);
      expect(refresh.clearBlockFacts).toHaveBeenCalledWith("client-1");
      expect(refresh.invalidateTrainingData).toHaveBeenCalledWith("client-1");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();

      await act(async () => {
        trainingRefetch.release(undefined);
        await trainingRefetch.promise;
      });

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(toast.success).toHaveBeenCalledWith('"Strength" removed');
    });

    it("a running program is ended, and says so", async () => {
      withPrograms();
      deleteTarget.value = {
        id: "p1",
        name: "Upper Lower",
        startsOn: "2026-08-31",
        endsOn: "2026-10-04",
        hasStarted: true,
        sessionsFrom: "today",
      };
      fetchMock.mockResolvedValue(answer(200, { success: true }));
      renderHero();

      fireEvent.click(screen.getByRole("button", { name: "bin-plan" }));
      expect(screen.getByRole("heading", { name: "End plan?" })).toBeInTheDocument();
      fireEvent.click(confirmButton());

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('"Upper Lower" ended'));
      expect(fetchMock).toHaveBeenCalledWith("/api/clients/client-1/training/p1", { method: "DELETE" });
    });

    it("after one delete, the next bin opens a confirm that isn't still spinning", async () => {
      withPrograms();
      fetchMock.mockResolvedValue(answer(200, { success: true }));
      renderHero();

      fireEvent.click(screen.getByRole("button", { name: "bin-next" }));
      fireEvent.click(confirmButton());
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      fireEvent.click(screen.getByRole("button", { name: "bin-plan" }));
      expect(confirmButton()).toBeEnabled();
      expect(confirmButton().querySelector(".animate-spin")).toBeNull();
    });

    it("a failed delete stays open as the retry and refreshes nothing", async () => {
      withPrograms();
      fetchMock.mockResolvedValue(answer(500, { error: "Failed to delete plan" }));
      renderHero();

      fireEvent.click(screen.getByRole("button", { name: "bin-next" }));
      fireEvent.click(confirmButton());

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Delete failed", { description: "Failed to delete plan" }),
      );
      await waitFor(() => expect(confirmButton()).toBeEnabled());
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      for (const hook of Object.values(refresh)) expect(hook).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("the confirm outlives the line it came from, and the hero's refetch", async () => {
      withPrograms();
      const trainingRefetch = deferred<undefined>();
      fetchMock.mockResolvedValue(answer(200, { success: true }));
      refresh.invalidateTrainingData.mockReturnValue(trainingRefetch.promise);
      const { rerender } = renderHero();

      fireEvent.click(screen.getByRole("button", { name: "bin-next" }));
      fireEvent.click(confirmButton());
      await waitFor(() => expect(refresh.invalidateTrainingData).toHaveBeenCalled());

      // The refetch lands behind the confirm: Strength has gone from the hero.
      ctx.value = { ...(ctx.value as object), nextPlan: null };
      rerender(<TrainingPlanHero clientId="client-1" />);
      expect(screen.queryByTestId("line-next")).toBeNull();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Even a hero that goes pending keeps the question on screen.
      ctx.value = { ...(ctx.value as object), isPending: true };
      rerender(<TrainingPlanHero clientId="client-1" />);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await act(async () => {
        trainingRefetch.release(undefined);
        await trainingRefetch.promise;
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });
  });
});
