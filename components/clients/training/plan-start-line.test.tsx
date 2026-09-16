import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { PlanStartLine } from "./plan-start-line";
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

type LineProps = Parameters<typeof PlanStartLine>[0];

function renderLine(overrides: Partial<LineProps> = {}) {
  return render(
    <PlanStartLine
      clientId={CLIENT}
      kind="start"
      program={{ id: "plan-1", name: "Upper Lower", startsOn: "2026-09-28" }}
      clientToday={TODAY}
      floor={TODAY}
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

describe("PlanStartLine", () => {
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
    it("a program that hasn't started: Starts, its date, and a pencil", () => {
      renderLine();
      const line = pencil().closest("p");
      expect(line?.textContent).toBe(`Starts${formatDateOnlyWeekday("2026-09-28")}`);
      expect(pencil()).toBeEnabled();
    });

    it("a program starting today, before the client has logged a workout: Starts today, with a pencil", () => {
      renderLine({ program: { id: "plan-1", name: "Upper Lower", startsOn: TODAY } });
      expect(pencil().closest("p")?.textContent).toBe("Starts today");
    });

    it("a program starting today, once the client has logged a workout: no line", () => {
      const { container } = renderLine({
        program: { id: "plan-1", name: "Upper Lower", startsOn: TODAY },
        floor: TOMORROW,
      });
      expect(container).toBeEmptyDOMElement();
    });

    it("a running program: no line", () => {
      const { container } = renderLine({
        program: { id: "plan-1", name: "Upper Lower", startsOn: "2026-08-31" },
      });
      expect(container).toBeEmptyDOMElement();
    });

    it("the next program: Next, its name and date, with its own pencil", () => {
      renderLine({ kind: "next", program: { id: "plan-2", name: "Strength", startsOn: "2026-10-05" } });
      const button = pencil("Change Strength's start date");
      expect(button.closest("p")?.textContent).toBe(
        `Next: Strength, starts${formatDateOnlyWeekday("2026-10-05")}`,
      );
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

    it("picking the current start closes it and moves nothing", () => {
      renderLine();
      openCalendar();
      fireEvent.click(day(/current start$/));

      expect(screen.queryByText("Sep 2026")).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(pencil()).toBeEnabled();
    });

    it("still shows what it was opened on while it fades out", () => {
      holdExitAnimation();
      fetchMock.mockReturnValue(new Promise(() => {}));
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
    it("sends the day, spins until the Training tab has refetched, then says it moved", async () => {
      const response = deferred<FetchResult>();
      const trainingRefetch = deferred<undefined>();
      fetchMock.mockReturnValue(response.promise);
      refresh.invalidateTrainingData.mockReturnValue(trainingRefetch.promise);
      renderLine();

      openCalendar();
      fireEvent.click(day(/^Wednesday 30 September 2026$/));

      // One click: the calendar closes and the pencil spins in its place.
      expect(screen.queryByText("Sep 2026")).toBeNull();
      expect(pencil()).toBeDisabled();
      expect(pencil().querySelector(".animate-spin")).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledWith(`/api/clients/${CLIENT}/training/plan-1/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsOn: "2026-09-30" }),
      });

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
      // …and until the Training tab has refetched, the pencil still spins.
      expect(pencil()).toBeDisabled();
      expect(toast.success).not.toHaveBeenCalled();

      await act(async () => {
        trainingRefetch.release(undefined);
        await trainingRefetch.promise;
      });

      await waitFor(() => expect(pencil()).toBeEnabled());
      expect(pencil().querySelector(".animate-spin")).toBeNull();
      expect(toast.success).toHaveBeenCalledWith("Program moved");
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("the next program moves through its own id", async () => {
      fetchMock.mockResolvedValue(answer(200, { success: true }));
      renderLine({ kind: "next", program: { id: "plan-2", name: "Strength", startsOn: "2026-10-05" } });

      openCalendar("Change Strength's start date");
      fireEvent.click(day(/^Monday 12 October 2026$/));

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Program moved"));
      expect(fetchMock.mock.calls[0][0]).toBe(`/api/clients/${CLIENT}/training/plan-2/move`);
    });

    it("a refused move says why in the server's sentence, and refreshes nothing", async () => {
      fetchMock.mockResolvedValue(answer(409, { error: "That would overlap Strength." }));
      renderLine();

      openCalendar();
      fireEvent.click(day(/^Wednesday 30 September 2026$/));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Program not moved", {
          description: "That would overlap Strength.",
        }),
      );
      await waitFor(() => expect(pencil()).toBeEnabled());
      for (const hook of Object.values(refresh)) expect(hook).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("a request that fails says so, and refreshes nothing", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      renderLine();

      openCalendar();
      fireEvent.click(day(/^Wednesday 30 September 2026$/));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Program not moved", {
          description: "Something went wrong. Try again.",
        }),
      );
      await waitFor(() => expect(pencil()).toBeEnabled());
      for (const hook of Object.values(refresh)) expect(hook).not.toHaveBeenCalled();
    });
  });
});
