import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig, type Cache } from "swr";

import { StepHabits } from "./step-habits";
import type { ClientHabitWeek, HabitDayFacts, HabitWeekRow } from "@/types/habits";

// The Habits step's transitions (CONVENTIONS §7 → "No frame disagrees"), over
// the real week hook and a real SWR cache; only the network is stubbed. Every
// commit is snapshotted: the Monday's tick and the row's week figure must
// agree in each one — a tick shown with the old figure, or the figure moved
// without the tick, is a frame the settled screen does not have.

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const DATES = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
const MON = "2026-09-28";

const day = (date: string, facts: Partial<HabitDayFacts> = {}): HabitDayFacts => ({
  date, covered: true, planned: false, target: null, edited: false, versionId: "v", timesPerWeek: null, entry: null, met: false, ...facts,
});

/**
 * The coach's plan for Mobility as the server has it: Mon, Wed, Fri as set;
 * the Wednesday taken off from the Tuesday; or stopped from the Monday.
 */
type Plan = "as set" | "no Wednesday" | "stopped Monday";

/** Each plan's week, the Monday ticked or not — the server's own figures for it. */
const FIGURES: Record<`${Plan}|${boolean}`, HabitWeekRow["figures"]> = {
  "as set|false": { planned: 3, done: 2, met: 2 },
  "as set|true": { planned: 3, done: 3, met: 3 },
  "no Wednesday|false": { planned: 2, done: 2, met: 2 },
  "no Wednesday|true": { planned: 2, done: 3, met: 2 },
  // Stopped from the Monday: the Tuesday's entry stays, in no figure.
  "stopped Monday|false": { planned: 1, done: 1, met: 1 },
  "stopped Monday|true": { planned: 1, done: 1, met: 1 },
};

/** Mobility: done on the Friday and made up on the Tuesday; the Monday ticked or not. */
function mobility(mondayDone: boolean, plan: Plan = "as set"): HabitWeekRow {
  const done = ["2026-09-25", "2026-09-29", ...(mondayDone ? [MON] : [])];
  const plannedDays = plan === "no Wednesday" ? ["2026-09-25", MON] : ["2026-09-25", MON, "2026-09-30"];
  return {
    habit: { id: "mobility", name: "Mobility", howTo: null, measure: "tick", unit: null, direction: null },
    words: { schedule: "Mon, Wed, Fri", target: null },
    days: DATES.map((date) => {
      const covered = plan !== "stopped Monday" || date < MON;
      const entry = done.includes(date) ? { done: true, value: null, note: null } : null;
      return day(date, { covered, planned: covered && plannedDays.includes(date), entry, met: covered && entry !== null });
    }),
    figures: FIGURES[`${plan}|${mondayDone}`],
  };
}

const weekWith = (mondayDone: boolean, plan: Plan = "as set"): ClientHabitWeek => {
  const row = mobility(mondayDone, plan);
  return { start: DATES[0], end: DATES[6], dates: DATES, habits: [row], totals: row.figures };
};

type Frame = { ticked: boolean; figure: string };
let frames: Frame[] = [];
const snapshot = (): Frame => {
  const tick = screen.queryByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" });
  return {
    ticked: tick?.getAttribute("data-state") === "checked",
    figure: tick?.closest("tr")?.lastElementChild?.textContent ?? "",
  };
};

/** Mobility's Monday as drawn — ticked, not, or a dash for a day it does not run — beside the row's week figure. */
type MondayFrame = { monday: "ticked" | "unticked" | "not running"; figure: string };
let mondayFrames: MondayFrame[] = [];
const mondaySnapshot = (): MondayFrame | null => {
  const row = screen.queryByText("Mobility")?.closest("tr");
  if (!row) return null;
  const tick = row.children[1 + DATES.indexOf(MON)].querySelector('[role="checkbox"]');
  const monday = tick ? (tick.getAttribute("data-state") === "checked" ? "ticked" : "unticked") : "not running";
  return { monday, figure: row.lastElementChild?.textContent ?? "" };
};

/** The server's Monday, ticked once a write saves it. */
let saved: boolean;
/** The coach deleted Mobility: the server's week no longer lists it. */
let gone: boolean;
/** The coach's plan for Mobility as the server has it now. */
let plan: Plan;
let answerWrite: (status: number, body: unknown) => void = () => {};
let loseWrite: () => void = () => {};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  frames = [];
  mondayFrames = [];
  saved = false;
  gone = false;
  plan = "as set";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T18:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") {
        return new Promise<Response>((resolve, reject) => {
          answerWrite = (status, body) => resolve(reply(status, body));
          loseWrite = () => reject(new TypeError("Failed to fetch"));
        });
      }
      const week = gone
        ? { start: DATES[0], end: DATES[6], dates: DATES, habits: [], totals: { planned: 0, done: 0, met: 0 } }
        : weekWith(saved, plan);
      return Promise.resolve(reply(200, { success: true, data: week }));
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderStep(cache: Cache) {
  return render(
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, errorRetryCount: 0 }}>
      <Profiler
        id="habits-step"
        onRender={() => {
          frames.push(snapshot());
          const monday = mondaySnapshot();
          if (monday) mondayFrames.push(monday);
        }}
      >
        <StepHabits habitWeek={weekWith(false)} clientTimezone="Europe/London" logsOpenFrom="2026-09-24" trackWrite={() => {}} disabled={false} />
      </Profiler>
    </SWRConfig>
  );
}

/** Every frame shows the Monday and the week's figure agreeing: both before the tick, or both after it. */
function expectAgreeing(list: Frame[]) {
  for (const frame of list) {
    expect([
      { ticked: false, figure: "2 of 3" },
      { ticked: true, figure: "3 of 3" },
    ]).toContainEqual(frame);
  }
}

describe("the Habits step's frames", () => {
  it("shows a tick and the figure it moves in one commit, and the answer lands with no frame between", async () => {
    const user = userEvent.setup();
    renderStep(new Map());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    frames = [];
    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));
    expectAgreeing(frames);
    expect(frames.at(-1)).toEqual({ ticked: true, figure: "3 of 3" });

    frames = [];
    saved = true;
    await act(async () => {
      answerWrite(200, {
        success: true,
        data: {
          day: mobility(true).days[4],
          week: { planned: 3, done: 3, met: 3, start: DATES[0], end: DATES[6] },
        },
      });
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    // From the answer to the settled screen, the Monday never flashes back.
    for (const frame of frames) expect(frame).toEqual({ ticked: true, figure: "3 of 3" });
  });

  it("takes a refused tick back with its figure in one commit", async () => {
    const user = userEvent.setup();
    renderStep(new Map());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));

    frames = [];
    await act(async () => {
      answerWrite(403, { success: false, error: "This day is locked." });
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expectAgreeing(frames);
    expect(frames.at(-1)).toEqual({ ticked: false, figure: "2 of 3" });
  });

  it("comes back after Back and Next showing the figures as the client left them, from its first commit", async () => {
    const user = userEvent.setup();
    const cache: Cache = new Map();
    const first = renderStep(cache);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));
    saved = true;
    await act(async () => {
      answerWrite(200, {
        success: true,
        data: { day: mobility(true).days[4], week: { planned: 3, done: 3, met: 3, start: DATES[0], end: DATES[6] } },
      });
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    // Back: the step leaves the page.
    first.unmount();

    // Next: the step comes back with the context's week, read at the start.
    frames = [];
    renderStep(cache);
    expect(frames[0]).toEqual({ ticked: true, figure: "3 of 3" });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    for (const frame of frames) expect(frame).toEqual({ ticked: true, figure: "3 of 3" });
  });

  it("takes a habit deleted underneath the tick off the step with its change in one commit, never unticked first", async () => {
    const user = userEvent.setup();
    renderStep(new Map());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));

    frames = [];
    gone = true;
    await act(async () => {
      answerWrite(404, { success: false, error: "Habit not found." });
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByText("Mobility")).not.toBeInTheDocument());
    // The row goes with its tick: no commit shows it back to "2 of 3".
    for (const frame of frames) expect([{ ticked: true, figure: "3 of 3" }, { ticked: false, figure: "" }]).toContainEqual(frame);
  });

  it("lands a tick the coach's stop refused (409) as the server has the habit, the change dropped in the same commit", async () => {
    const user = userEvent.setup();
    renderStep(new Map());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));

    mondayFrames = [];
    plan = "stopped Monday";
    await act(async () => {
      answerWrite(409, { success: false, error: "That habit isn't running on that day." });
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    await waitFor(() => expect(mondaySnapshot()).toEqual({ monday: "not running", figure: "1 of 1" }));
    // Never the tick taken back first: no commit shows the Monday unticked.
    for (const frame of mondayFrames) {
      expect([
        { monday: "ticked", figure: "3 of 3" },
        { monday: "not running", figure: "1 of 1" },
      ]).toContainEqual(frame);
    }
  });

  it("takes back a tick whose answer never came, and which the server did not save, with its figure in one commit", async () => {
    const user = userEvent.setup();
    renderStep(new Map());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));

    frames = [];
    await act(async () => {
      loseWrite();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expectAgreeing(frames);
    expect(frames.at(-1)).toEqual({ ticked: false, figure: "2 of 3" });
  });

  it("keeps a tick through a week read again for an answer the coach's change of another day disagrees with, landing the new figure with it", async () => {
    const user = userEvent.setup();
    renderStep(new Map());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));

    frames = [];
    saved = true;
    plan = "no Wednesday";
    await act(async () => {
      answerWrite(200, {
        success: true,
        data: { day: mobility(true, plan).days[4], week: { ...FIGURES["no Wednesday|true"], start: DATES[0], end: DATES[6] } },
      });
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    await waitFor(() => expect(snapshot()).toEqual({ ticked: true, figure: "2 of 2" }));
    // The Monday stays ticked from the answer to the week read again.
    for (const frame of frames) {
      expect([
        { ticked: true, figure: "3 of 3" },
        { ticked: true, figure: "2 of 2" },
      ]).toContainEqual(frame);
    }
  });

  it("keeps a tick whose answer never came, when the week read again shows it saved, with no commit taking it back", async () => {
    const user = userEvent.setup();
    renderStep(new Map());
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await user.click(screen.getByRole("checkbox", { name: "Mobility, Mon 28 Sept, planned" }));

    frames = [];
    saved = true;
    await act(async () => {
      loseWrite();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    for (const frame of frames) expect(frame).toEqual({ ticked: true, figure: "3 of 3" });
  });
});
