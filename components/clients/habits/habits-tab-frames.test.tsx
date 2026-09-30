import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

import { HabitsTabContent } from "./habits-tab-content";
import type { Client } from "@/types/check-in";
import type { CoachHabit, CoachHabitList, CoachHabitWeek, HabitChoice, HabitDayFacts, HabitVersion } from "@/types/habits";

// The frame tests of the Habits tab (CONVENTIONS §7 → "No frame disagrees",
// rule 6), over the real reads, the real writes hook and a real SWR cache;
// only the network is stubbed. Every save changes two things on screen: the
// surface it was made in closes, and the card shows what the save made. The
// write's own answer is put in the cache in the same tick the surface closes
// (CONVENTIONS §7 → "Refreshing after a write"), so NO commit — recorded by a
// Profiler after each one — shows the card loading, the surface closed over
// the old figures, or the surface still open over the new ones. jsdom paints
// nothing; a commit is the finest frame there is.

const TODAY = "2026-09-30";
const DATES = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const CLIENT = { id: "client-3" } as Client;
const AREA = "/api/clients/client-3/habits";

const version = (startsOn: string, over: Partial<HabitVersion> = {}): HabitVersion => ({
  id: `v-${startsOn}`,
  startsOn,
  endsOn: null,
  target: null,
  timesPerWeek: null,
  weekdays: [...EVERY_DAY],
  ...over,
});

const habit = (name: string, status: CoachHabit["status"], over: Partial<CoachHabit> = {}): CoachHabit => ({
  id: name,
  name,
  howTo: null,
  measure: "tick",
  unit: null,
  direction: null,
  position: 0,
  versions: [version("2026-09-01")],
  dayEdits: [],
  hasEntries: true,
  status,
  words: { schedule: "Every day", target: null },
  ...over,
});

const day = (date: string, over: Partial<HabitDayFacts> = {}): HabitDayFacts => ({
  date,
  covered: true,
  planned: true,
  target: null,
  edited: false,
  versionId: "v",
  timesPerWeek: null,
  entry: null,
  met: false,
  ...over,
});

/** A client week, Walk met on its first `walkMet` days; `walkToday` changes Walk's day on the client's today. */
function week(walkMet: number, dates = DATES, walkToday: Partial<HabitDayFacts> = {}): CoachHabitWeek {
  const holdsToday = dates.includes(TODAY);
  return {
    clientToday: TODAY,
    start: dates[0],
    end: dates[6],
    dates,
    habits: [
      {
        habit: { id: "Walk", name: "Walk", howTo: null, measure: "tick", unit: null, direction: null },
        words: { schedule: "Every day", target: null },
        days: dates.map((date, i) =>
          day(date, { ...(i < walkMet ? { entry: { done: true, value: null, note: null }, met: true } : {}), ...(date === TODAY ? walkToday : {}) })
        ),
        figures: { planned: 7, done: walkMet, met: walkMet },
        deleted: false,
      },
      {
        habit: { id: "Run", name: "Run", howTo: null, measure: "tick", unit: null, direction: null },
        words: { schedule: "Every day", target: null },
        days: dates.map((date) => day(date)),
        figures: { planned: 7, done: 0, met: 0 },
        deleted: false,
      },
    ],
    totals: { planned: 14, done: walkMet, met: walkMet },
    today: holdsToday ? { planned: 2, done: 0 } : null,
  };
}

const BEFORE_LIST: CoachHabitList = {
  clientToday: TODAY,
  habits: [habit("Walk", "running"), habit("Run", "running"), habit("Meditation", "stopped", { versions: [version("2026-08-01", { endsOn: "2026-09-11" })] })],
};
const AFTER_LIST: CoachHabitList = { ...BEFORE_LIST, habits: [BEFORE_LIST.habits[1], BEFORE_LIST.habits[0], BEFORE_LIST.habits[2]] };
const BEFORE_WEEK = week(1);
const AFTER_WEEK = week(2);

/** The client week before the current one, which the coach pages back to. */
const LAST_START = "2026-09-17";
const LAST_DATES = ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];
const LAST_BEFORE = week(3, LAST_DATES);
const LAST_AFTER = week(4, LAST_DATES);

/** A habit given to another client, offered by the Add habits sheet. */
const SAUNA_CHOICE: HabitChoice = {
  name: "Sauna",
  howTo: null,
  measure: "tick",
  unit: null,
  direction: null,
  target: null,
  timesPerWeek: 3,
  weekdays: [],
  words: { schedule: "3 times a week", target: null },
};

type Frame = {
  /** The dialog or sheet the save was made in: open, closed (fading out) or gone. */
  surface: string;
  /** What that surface shows: its title, and a reused habit's name while the Add habits sheet lists one. */
  surfaceShows: string | null;
  /** Anything on the page loading: the card, the summary, or the closing surface. */
  loading: boolean;
  /** The summary's This week: always the week holding the client's today. */
  thisWeek: string | null;
  /** The table's figure for Walk under Week: the week on screen. */
  walkWeek: string | null;
  firstRow: string | null;
  /** A ⋯ spinning: a move in flight. */
  spinning: boolean;
};
let frames: Frame[] = [];

function snapshot(): Frame {
  const surface = document.querySelector<HTMLElement>('[role="dialog"]');
  const band = document.querySelector('[data-slot="stat-band"]');
  const title = surface?.querySelector("h2")?.textContent ?? null;
  const reused = surface?.querySelector('[role="checkbox"]')?.textContent ?? null;
  const walkCells = screen.queryByText("Walk", { selector: "tbody p" })?.closest("tr")?.querySelectorAll("td");
  return {
    surface: surface ? (surface.getAttribute("data-state") ?? "open") : "none",
    surfaceShows: surface ? [title, reused].filter(Boolean).join(" | ") : null,
    loading: document.querySelectorAll('[data-slot="skeleton"]').length > 0,
    thisWeek: band ? (within(band as HTMLElement).queryByText("This week")?.nextElementSibling?.textContent ?? null) : null,
    // The row's cells: the habit, the seven days, Week, then the ⋯.
    walkWeek: walkCells ? (walkCells[walkCells.length - 2]?.textContent ?? null) : null,
    firstRow: document.querySelector("tbody tr p")?.textContent ?? null,
    spinning: document.querySelector("tbody .animate-spin") !== null,
  };
}

/** The write in flight, answered by the test. */
let pending: { resolve: (body: unknown) => void; answered: Promise<Response> } | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

function respond(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

/** The reads the server answers: the list, the current week (`currentWeek`), the week before it and the choices. */
function stubNetwork(currentWeek: CoachHabitWeek = BEFORE_WEEK) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      let answerWith: (body: unknown) => void = () => {};
      const answered = new Promise<Response>((resolve) => (answerWith = (body) => resolve(respond(body))));
      pending = { resolve: answerWith, answered };
      return answered;
    }
    if (url === AREA) return Promise.resolve(respond({ success: true, data: BEFORE_LIST }));
    if (url === `${AREA}/week`) return Promise.resolve(respond({ success: true, data: currentWeek }));
    if (url === `${AREA}/week?start=${LAST_START}`) return Promise.resolve(respond({ success: true, data: LAST_BEFORE }));
    if (url === `${AREA}/choices`) return Promise.resolve(respond({ success: true, data: [SAUNA_CHOICE] }));
    return Promise.reject(new Error(`unexpected read ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** Every read sent so far, by URL. */
const readsSent = () => fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === "GET").map(([url]) => url as string);
/** The write sent, by URL. */
const writeSent = () => fetchMock.mock.calls.find(([, init]) => (init?.method ?? "GET") !== "GET")?.[0] as string | undefined;

// jsdom computes no animation, so Radix unmounts a closing card at once. Radix
// holds a card while its animation name changes, as the fade does in a
// browser, so naming one keeps each closing frame on the page to be read.
function holdExitAnimation() {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const styles = computed(element, pseudo);
    if (element instanceof HTMLElement && (element.dataset.slot === "dialog-content" || element.dataset.slot === "sheet-content")) {
      Object.defineProperty(styles, "animationName", {
        get: () => (element.dataset.state === "closed" ? "exit" : "enter"),
      });
    }
    return styles;
  });
}

/** Ends a held closing card's fade, as the browser does once it has played: Radix then unmounts the card. */
function finishExit() {
  for (const node of document.querySelectorAll<HTMLElement>('[data-slot="dialog-content"][data-state="closed"]')) {
    const ended = new Event("animationend");
    Object.defineProperty(ended, "animationName", { value: "exit" });
    act(() => {
      node.dispatchEvent(ended);
    });
  }
}

function Recorded({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Profiler id="habits-tab" onRender={() => frames.push(snapshot())}>
        {children}
      </Profiler>
    </SWRConfig>
  );
}

async function renderTab() {
  render(
    <Recorded>
      <HabitsTabContent client={CLIENT} />
    </Recorded>
  );
  await screen.findByText("Walk", { selector: "p" });
  await waitFor(() => expect(snapshot().thisWeek).toBe("1/14"));
}

/** What the surface shows as the save is sent: every closing frame must still show it. */
let shownAtSave: string | null = null;

/** Sends the save: what the surface shows is noted first. */
function save(button: string) {
  shownAtSave = snapshot().surfaceShows;
  fireEvent.click(screen.getByRole("button", { name: button }));
}

/**
 * Answers the write in flight with the habits and the week the save made —
 * on the current week, as the server does, with no second week — and lets
 * every commit land.
 */
async function answer(body: Record<string, unknown>) {
  frames = [];
  await act(async () => {
    pending?.resolve({ success: true, data: { habits: AFTER_LIST, week: AFTER_WEEK, currentWeek: null, ...body } });
    await pending?.answered;
  });
  await waitFor(() => expect(snapshot().thisWeek).toBe("2/14"));
}

/**
 * Every commit from the answer on: nothing loading; the surface open exactly
 * while the old figures show; and a closing surface still showing what it
 * showed at the save.
 */
function expectInPlace() {
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    expect(frame.loading).toBe(false);
    expect(frame.thisWeek === "1/14").toBe(frame.surface === "open");
    if (frame.surface !== "none") expect(frame.surfaceShows).toBe(shownAtSave);
  }
  expect(frames.at(-1)).toMatchObject({ thisWeek: "2/14" });
  expect(frames.at(-1)?.surface).not.toBe("open");
  // The card was put on screen from the answer: neither read on screen was fetched again.
  expect(readsSent().filter((url) => url === AREA || url === `${AREA}/week`)).toHaveLength(2);
}

beforeEach(() => {
  vi.clearAllMocks();
  frames = [];
  pending = null;
  stubNetwork();
  holdExitAnimation();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openRowDialog(name: string, item: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  await user.click(screen.getByRole("menuitem", { name: item }));
  await screen.findByRole("dialog");
  return user;
}

describe("after every save the card changes in place, with no loading frame", () => {
  it("Stop", async () => {
    await renderTab();
    await openRowDialog("Walk", "Stop");
    save("Stop habit");
    await answer({ changed: true });
    expectInPlace();
  });

  it("Delete", async () => {
    await renderTab();
    await openRowDialog("Walk", "Delete");
    save("Delete habit");
    await answer({ changed: true });
    expectInPlace();
  });

  it("Rename", async () => {
    await renderTab();
    const user = await openRowDialog("Walk", "Rename");
    await user.type(screen.getByLabelText("Name"), "s");
    save("Save");
    await answer({ changed: true });
    expectInPlace();
  });

  it("Change target or days", async () => {
    await renderTab();
    const user = await openRowDialog("Walk", "Change target or days");
    await user.click(screen.getByRole("button", { name: "Times a week" }));
    save("Save");
    await answer({ changed: true });
    expectInPlace();
  });

  it("Start again", async () => {
    await renderTab();
    await openRowDialog("Meditation", "Start again");
    save("Start again");
    await answer({ changed: true });
    expectInPlace();
  });

  it("This day", async () => {
    await renderTab();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Walk, Wed 30 Sept" }));
    await user.click(screen.getByRole("switch", { name: "Planned" }));
    save("Save");
    await answer({ changed: true });
    expectInPlace();
  });

  it("This day's Reset", async () => {
    stubNetwork(week(1, DATES, { planned: false, edited: true }));
    await renderTab();
    await userEvent.setup().click(screen.getByRole("button", { name: "Walk, Wed 30 Sept" }));
    save("Reset");
    await answer({ changed: true });
    expectInPlace();
  });

  // The sheet lists a habit given to another client; as it slides shut after
  // the save, it still lists it — never loading bars.
  it("Add habits", async () => {
    await renderTab();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add habits" }));
    await screen.findByRole("checkbox", { name: /^Sauna/ });
    await user.click(screen.getByRole("button", { name: "New habit" }));
    await user.type(screen.getByLabelText("Name"), "Stretch");
    save("Add habit");
    expect(shownAtSave).toBe("Add habits | Sauna3 times a week");
    await answer({ habitIds: ["Stretch"] });
    expectInPlace();
  });

  // A move is made from the ⋯ with no surface of its own: its answer moves the
  // row, puts the new week on screen and settles the spinning ⋯ in one
  // commit, with no loading frame.
  it("Move down", async () => {
    await renderTab();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Walk" }));
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));
    await waitFor(() => expect(pending).not.toBeNull());
    await waitFor(() => expect(snapshot().spinning).toBe(true));
    expect(snapshot().firstRow).toBe("Walk");
    frames = [];
    await act(async () => {
      pending?.resolve({ success: true, data: { changed: true, habits: AFTER_LIST, week: AFTER_WEEK, currentWeek: null } });
      await pending?.answered;
    });
    await waitFor(() => expect(snapshot().firstRow).toBe("Run"));
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.loading).toBe(false);
      // The new order, the new week and the settled ⋯ arrive together.
      expect(frame.firstRow === "Run").toBe(frame.thisWeek === "2/14");
      expect(frame.spinning).toBe(frame.firstRow === "Walk");
    }
    expect(frames.at(-1)).toMatchObject({ firstRow: "Run", thisWeek: "2/14", spinning: false });
    expect(readsSent().filter((url) => url === AREA || url === `${AREA}/week`)).toHaveLength(2);
  });

  // A save made on a week paged to names it: the answer carries that week
  // and the current one, and both land with the list as the dialog closes —
  // the table's week and the summary's now change together, nothing read
  // again.
  it("a save on a week paged to", async () => {
    await renderTab();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(snapshot().walkWeek).toBe("3/7"));
    expect(snapshot().thisWeek).toBe("1/14");

    await openRowDialog("Walk", "Stop");
    save("Stop habit");
    expect(writeSent()).toBe(`${AREA}/Walk/stop?week=${LAST_START}`);
    frames = [];
    await act(async () => {
      pending?.resolve({ success: true, data: { changed: true, habits: AFTER_LIST, week: LAST_AFTER, currentWeek: AFTER_WEEK } });
      await pending?.answered;
    });
    await waitFor(() => expect(snapshot().walkWeek).toBe("4/7"));

    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.loading).toBe(false);
      expect(frame.walkWeek === "3/7").toBe(frame.surface === "open");
      expect(frame.thisWeek === "1/14").toBe(frame.surface === "open");
      if (frame.surface !== "none") expect(frame.surfaceShows).toBe(shownAtSave);
    }
    expect(frames.at(-1)).toMatchObject({ walkWeek: "4/7", thisWeek: "2/14" });
    expect(frames.at(-1)?.surface).not.toBe("open");
    // The list, the week on screen and the current week: each read once, before the save.
    expect(readsSent().filter((url) => url.startsWith(AREA) && url !== `${AREA}/choices`)).toEqual([
      AREA,
      `${AREA}/week`,
      `${AREA}/week?start=${LAST_START}`,
    ]);
  });

  // A save that changed nothing — a stop dated after the stop already
  // scheduled — closes its dialog over the card as it was, and leaves every
  // week already read as it was: paging back shows the week at once.
  it("a save that changed nothing", async () => {
    await renderTab();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(snapshot().walkWeek).toBe("3/7"));
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(snapshot().walkWeek).toBe("1/7"));

    await openRowDialog("Walk", "Stop");
    save("Stop habit");
    frames = [];
    await act(async () => {
      pending?.resolve({ success: true, data: { changed: false, habits: BEFORE_LIST, week: BEFORE_WEEK, currentWeek: null } });
      await pending?.answered;
    });
    await waitFor(() => expect(snapshot().surface).not.toBe("open"));
    expect(toast).toHaveBeenCalledWith("Nothing changed");
    expect(toast.success).not.toHaveBeenCalled();
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).toMatchObject({ loading: false, thisWeek: "1/14", walkWeek: "1/7" });
      if (frame.surface !== "none") expect(frame.surfaceShows).toBe(shownAtSave);
    }

    finishExit();
    expect(snapshot().surface).toBe("none");
    frames = [];
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(snapshot().walkWeek).toBe("3/7");
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame.loading).toBe(false);
  });
});
