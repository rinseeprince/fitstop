import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { PlanHeroLine } from "./plan-hero-line";
import { formatDateOnlyWeekday } from "@/components/clients/overview/overview-format";

// Every screen a move changes is refreshed through its own hook; the mocks say
// which were asked, and the training one resolves when the test says so — the
// frame in which the pencil must still spin.
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

const CLIENT = "client-1";
// Wednesday 16 September 2026 is the client's today.
const TODAY = "2026-09-16";
const TOMORROW = "2026-09-17";

type LineProps = Parameters<typeof PlanHeroLine>[0];

const onDelete = vi.fn();

function renderLine(overrides: Partial<LineProps> = {}) {
  return render(
    <PlanHeroLine
      clientId={CLIENT}
      kind="plan"
      program={{ id: "plan-1", name: "Upper Lower", startsOn: "2026-09-28", endsOn: "2026-10-25" }}
      clientToday={TODAY}
      floor={TODAY}
      onDelete={onDelete}
      {...overrides}
    />,
  );
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

const pencil = (name = "Change start date") => screen.getByRole("button", { name });
const openCalendar = (name?: string) => fireEvent.click(pencil(name));
const day = (name: RegExp) => screen.getByRole("button", { name });

// jsdom computes no animation, so Radix unmounts a closing card at once. Naming
// an exit animation holds the closing frame on the page to be read.
function holdExitAnimation() {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const styles = computed(element, pseudo);
    if (element instanceof HTMLElement && element.dataset.slot === "popover-content") {
      Object.defineProperty(styles, "animationName", {
        get: () => (element.dataset.state === "closed" ? "exit" : "enter"),
      });
    }
    return styles;
  });
}

describe("PlanHeroLine", () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<FetchResult>>();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    for (const hook of Object.values(refresh)) hook.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("what the line says", () => {
    const bin = (name: string) => screen.getByRole("button", { name });

    it("a program that hasn't started: Starts, its date, a pencil and a bin", () => {
      renderLine();
      const line = pencil().closest("p");
      expect(line?.textContent).toBe(`Starts${formatDateOnlyWeekday("2026-09-28")}`);
      expect(bin("Remove Upper Lower").closest("p")).toBe(line);
    });

    it("a program starting today, before the client has logged a workout: Starts today, a pencil and a bin", () => {
      renderLine({ program: { id: "plan-1", name: "Upper Lower", startsOn: TODAY, endsOn: "2026-10-13" } });
      expect(pencil().closest("p")?.textContent).toBe("Starts today");
      expect(bin("Remove Upper Lower")).toBeInTheDocument();
    });

    it("a program starting today, once the client has logged a workout: Ends, its date and a bin, no pencil", () => {
      renderLine({
        program: { id: "plan-1", name: "Upper Lower", startsOn: TODAY, endsOn: "2026-10-13" },
        floor: TOMORROW,
      });
      expect(screen.queryByRole("button", { name: "Change start date" })).toBeNull();
      expect(bin("End Upper Lower").closest("p")?.textContent).toBe(
        `Ends${formatDateOnlyWeekday("2026-10-13")}`,
      );
    });

    it("a running program: Ends, its date and a bin, no pencil", () => {
      renderLine({ program: { id: "plan-1", name: "Upper Lower", startsOn: "2026-08-31", endsOn: "2026-10-04" } });
      expect(screen.queryByRole("button", { name: "Change start date" })).toBeNull();
      expect(bin("End Upper Lower").closest("p")?.textContent).toBe(
        `Ends${formatDateOnlyWeekday("2026-10-04")}`,
      );
    });

    it("a running program on its last day: Ends today", () => {
      renderLine({ program: { id: "plan-1", name: "Upper Lower", startsOn: "2026-08-31", endsOn: TODAY } });
      expect(bin("End Upper Lower").closest("p")?.textContent).toBe("Ends today");
    });

    it("the next program: Next, its name and date, with its own pencil and bin", () => {
      renderLine({
        kind: "next",
        program: { id: "plan-2", name: "Strength", startsOn: "2026-10-05", endsOn: "2026-10-18" },
      });
      const button = pencil("Change Strength's start date");
      expect(button.closest("p")?.textContent).toBe(
        `Next: Strength, starts${formatDateOnlyWeekday("2026-10-05")}`,
      );
      expect(bin("Remove Strength").closest("p")).toBe(button.closest("p"));
    });
  });

  describe("the bin", () => {
    it("hands a program that hasn't started to the hero, to be removed", () => {
      renderLine();
      fireEvent.click(screen.getByRole("button", { name: "Remove Upper Lower" }));
      expect(onDelete).toHaveBeenCalledWith({
        id: "plan-1",
        name: "Upper Lower",
        startsOn: "2026-09-28",
        endsOn: "2026-10-25",
        hasStarted: false,
        sessionsFrom: "today",
      });
    });

    it("hands a running program to the hero, to be ended from the floor", () => {
      renderLine({
        program: { id: "plan-1", name: "Upper Lower", startsOn: "2026-08-31", endsOn: "2026-10-04" },
        floor: TOMORROW,
      });
      fireEvent.click(screen.getByRole("button", { name: "End Upper Lower" }));
      expect(onDelete).toHaveBeenCalledWith({
        id: "plan-1",
        name: "Upper Lower",
        startsOn: "2026-08-31",
        endsOn: "2026-10-04",
        hasStarted: true,
        sessionsFrom: "tomorrow",
      });
    });
  });

  describe("the calendar", () => {
    it("opens on the program's start, with days before the first allowed start greyed", () => {
      renderLine({ floor: TOMORROW });
      openCalendar();

      expect(screen.getByText("Sep 2026")).toBeInTheDocument();
      expect(day(/^Monday 28 September 2026, current start$/)).toBeInTheDocument();
      expect(day(/^Wednesday 16 September 2026, today$/)).toBeDisabled();
      expect(day(/^Thursday 17 September 2026$/)).toBeEnabled();
    });

    it("picking the current start closes it, asks nothing and moves nothing", () => {
      renderLine();
      openCalendar();
      fireEvent.click(day(/current start$/));

      expect(screen.queryByText("Sep 2026")).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("still shows what it was opened on while it fades out", () => {
      holdExitAnimation();
      renderLine();
      openCalendar();
      fireEvent.click(day(/^Wednesday 30 September 2026$/));

      const closing = document.querySelector<HTMLElement>(
        '[data-slot="popover-content"][data-state="closed"]',
      );
      expect(closing).not.toBeNull();
      expect(closing?.textContent).toContain("Sep 2026");
      expect(
        closing?.querySelector('[aria-label="Monday 28 September 2026, current start"]'),
      ).not.toBeNull();
    });
  });

  describe("moving the program", () => {
    const pickDay = (name: RegExp, pencilName?: string) => {
      openCalendar(pencilName);
      fireEvent.click(day(name));
    };
    const moveButton = () => screen.getByRole("button", { name: /Move program/ });

    it("picking a day closes the calendar and asks first, naming the move; nothing is sent", () => {
      renderLine();
      pickDay(/^Wednesday 30 September 2026$/);

      expect(screen.queryByText("Sep 2026")).toBeNull();
      expect(screen.getByRole("heading", { name: "Move Upper Lower?" })).toBeInTheDocument();
      expect(
        screen.getByText(
          `It will start on ${formatDateOnlyWeekday("2026-09-30")}, and every session moves 2 days later with it.`,
        ),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Cancel closes the confirm and moves nothing", () => {
      renderLine();
      pickDay(/^Wednesday 30 September 2026$/);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      for (const hook of Object.values(refresh)) expect(hook).not.toHaveBeenCalled();
    });

    it("Move program sends the day, and the confirm spins until the Training tab has refetched", async () => {
      const response = deferred<FetchResult>();
      const trainingRefetch = deferred<undefined>();
      fetchMock.mockReturnValue(response.promise);
      refresh.invalidateTrainingData.mockReturnValue(trainingRefetch.promise);
      renderLine();

      pickDay(/^Wednesday 30 September 2026$/);
      fireEvent.click(moveButton());

      expect(fetchMock).toHaveBeenCalledWith(`/api/clients/${CLIENT}/training/plan-1/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsOn: "2026-09-30" }),
      });
      expect(moveButton()).toBeDisabled();
      expect(moveButton().querySelector(".animate-spin")).not.toBeNull();

      await act(async () => {
        response.release(answer(200, { success: true, data: { startsOn: "2026-09-30" } }));
        await response.promise;
      });

      // Every screen that reads the moved dates is refreshed…
      expect(refresh.invalidateNutritionCalendar).toHaveBeenCalledWith(CLIENT);
      expect(refresh.clearClientOverview).toHaveBeenCalledWith(CLIENT);
      expect(refresh.clearAttentionFeed).toHaveBeenCalledTimes(1);
      expect(refresh.clearBlockFacts).toHaveBeenCalledWith(CLIENT);
      expect(refresh.invalidateTrainingData).toHaveBeenCalledWith(CLIENT);
      // …and until the Training tab has refetched, the confirm stays, spinning.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(moveButton().querySelector(".animate-spin")).not.toBeNull();
      expect(toast.success).not.toHaveBeenCalled();

      await act(async () => {
        trainingRefetch.release(undefined);
        await trainingRefetch.promise;
      });

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(toast.success).toHaveBeenCalledWith("Program moved");
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("the next program moves through its own id", async () => {
      fetchMock.mockResolvedValue(answer(200, { success: true }));
      renderLine({
        kind: "next",
        program: { id: "plan-2", name: "Strength", startsOn: "2026-10-05", endsOn: "2026-10-18" },
      });

      pickDay(/^Monday 12 October 2026$/, "Change Strength's start date");
      expect(screen.getByRole("heading", { name: "Move Strength?" })).toBeInTheDocument();
      fireEvent.click(moveButton());

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Program moved"));
      expect(fetchMock.mock.calls[0][0]).toBe(`/api/clients/${CLIENT}/training/plan-2/move`);
    });

    it("a refused move closes the confirm, says why in the server's sentence, and refreshes nothing", async () => {
      fetchMock.mockResolvedValue(answer(409, { error: "That would overlap Strength." }));
      renderLine();

      pickDay(/^Wednesday 30 September 2026$/);
      fireEvent.click(moveButton());

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Program not moved", {
          description: "That would overlap Strength.",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      for (const hook of Object.values(refresh)) expect(hook).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("after a refused move, the next pick asks again with Move program ready", async () => {
      fetchMock.mockResolvedValue(answer(409, { error: "That would overlap Strength." }));
      renderLine();
      pickDay(/^Wednesday 30 September 2026$/);
      fireEvent.click(moveButton());
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      pickDay(/^Tuesday 29 September 2026$/);

      expect(screen.getByRole("heading", { name: "Move Upper Lower?" })).toBeInTheDocument();
      expect(moveButton()).toBeEnabled();
      expect(moveButton().querySelector(".animate-spin")).toBeNull();
    });

    it("a request that fails closes the confirm and says so, and refreshes nothing", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      renderLine();

      pickDay(/^Wednesday 30 September 2026$/);
      fireEvent.click(moveButton());

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Program not moved", {
          description: "Something went wrong. Try again.",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      for (const hook of Object.values(refresh)) expect(hook).not.toHaveBeenCalled();
    });

    it("the confirm outlives its pencil: a program that starts meanwhile keeps the question open", () => {
      const props: LineProps = {
        clientId: CLIENT,
        kind: "plan",
        program: { id: "plan-1", name: "Upper Lower", startsOn: TODAY, endsOn: "2026-10-13" },
        clientToday: TODAY,
        floor: TODAY,
        onDelete,
      };
      const { rerender } = render(<PlanHeroLine {...props} />);
      pickDay(/^Friday 18 September 2026$/);
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // The client logs a workout: the program has started, and its pencil goes.
      rerender(<PlanHeroLine {...props} floor={TOMORROW} />);

      expect(screen.queryByRole("button", { name: "Change start date" })).toBeNull();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Move Upper Lower?" })).toBeInTheDocument();
  });
  });
});
