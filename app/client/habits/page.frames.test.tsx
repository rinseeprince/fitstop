import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Profiler, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig, type Cache } from "swr";

import HabitsPage from "./page";
import ClientHomePage from "../page";
import type { ClientHabitDay, ClientHabitDayItem, HabitDaySummary, HabitDayFacts, HabitEntryResult } from "@/types/habits";

// The frame tests of the client's habits page (CONVENTIONS §7 → "No frame
// disagrees", rule 6), over the real page, the real entry hook and a real SWR
// cache; only the network is stubbed. Each entry changes one habit's row: the
// change shows in the commit after the gesture — the tick, the number, the
// note, judged by the kernel, the week moved by that day — and the answer
// lands on that row in the commit it arrives, so no commit shows the row going
// back, the page loading, or the habit leaving its group. jsdom paints
// nothing; a commit is the finest frame there is. Coming back to the home
// after an entry, its card shows the placeholder until the new count lands —
// never the count from before, and never another day's.

// The plan's Tuesday, in a client week running Thursday 24 to Wednesday 30 September.
const TODAY = "2026-09-29";
const YESTERDAY = "2026-09-28";
const DAY_URL = `/api/client/habits/day?date=${TODAY}`;
const SUMMARY_URL = `/api/client/day-summary?date=${TODAY}`;
const YESTERDAY_SUMMARY_URL = `/api/client/day-summary?date=${YESTERDAY}`;
const WEEK = { start: "2026-09-24", end: "2026-09-30" };

const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));
// The address: the home moves its date by replacing it, and the test commits the move.
const { address } = vi.hoisted(() => ({ address: { date: null as string | null, replaced: [] as string[] } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: (href: string) => address.replaced.push(href) }),
  useSearchParams: () => ({ get: (key: string) => (key === "date" ? address.date : null) }),
}));
// The profile read over the same SWR cache, so the day rule a 403 reads again lands where the page reads it.
vi.mock("@/hooks/use-client-profile", async () => {
  const { default: useSWR } = await import("swr");
  const { swrFetcher } = await import("@/lib/swr-fetcher");
  const { CLIENT_PROFILE_KEY } = await import("@/lib/client-profile-key");
  return {
    CLIENT_PROFILE_KEY,
    useClientProfile: () => {
      const { data } = useSWR<{ data: { timezone: string; logsOpenFrom: string | null } }>(CLIENT_PROFILE_KEY, swrFetcher);
      return { client: data?.data ?? { timezone: "UTC", logsOpenFrom: null }, error: null, isLoading: false, mutate: vi.fn() };
    },
  };
});
// The home's check-in card reads its own status; it is not what these frames are about.
vi.mock("@/components/client-portal/day/check-in-card-summary", () => ({ CheckInCardSummary: () => null }));

const facts = (over: Partial<HabitDayFacts> = {}): HabitDayFacts => ({
  date: TODAY,
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

// Today: Stretch every day, Sauna three times a week, Water at least 3 L every day (2 L so far).
const stretch: ClientHabitDayItem = {
  habit: { id: "Stretch", name: "Stretch", howTo: null, measure: "tick", unit: null, direction: null },
  day: facts(),
  week: { planned: 7, done: 1, met: 1, ...WEEK },
  words: { schedule: "Every day", target: null, week: "1 of 7" },
};
const sauna: ClientHabitDayItem = {
  habit: { id: "Sauna", name: "Sauna", howTo: null, measure: "tick", unit: null, direction: null },
  day: facts({ planned: false, timesPerWeek: 3 }),
  week: { planned: 3, done: 2, met: 2, ...WEEK },
  words: { schedule: "3 times a week", target: null, week: "2 of 3" },
};
const water: ClientHabitDayItem = {
  habit: { id: "Water", name: "Water", howTo: null, measure: "number", unit: "L", direction: "at_least" },
  day: facts({ target: 3, entry: { done: null, value: 2, note: null } }),
  week: { planned: 7, done: 3, met: 3, ...WEEK },
  words: { schedule: "Every day", target: "at least 3 L", week: "3 of 7" },
};

/** The home's day, before and after Stretch is ticked: Stretch and Water planned. */
const summary = (doneToday: number): HabitDaySummary => ({ plannedToday: 2, doneToday, running: 3, toDoThisWeek: 8 - doneToday });
/** Yesterday on the home: one habit planned, not done. */
const yesterdaySummary: HabitDaySummary = { plannedToday: 1, doneToday: 0, running: 3, toDoThisWeek: 7 };
const daySummary = (habits: HabitDaySummary) => ({
  success: true,
  data: {
    training: [],
    nutrition: { hasLog: false, caloriesConsumed: null, targetCalories: null, note: null },
    wellness: { hasLog: false },
    habits,
  },
});

/** The write in flight, answered (or lost) by the test. */
let pending: { body: unknown; respond: (status: number, body: unknown) => void; lose: () => void } | null = null;
/** The client's day rule as the server has it. */
let profile: { timezone: string; logsOpenFrom: string | null };
type Network = (url: string, init?: RequestInit) => Promise<Response>;
let fetchMock: Mock<Network>;
/** What the server's day read answers with. */
let serverDay: ClientHabitDay;
let homeHabits: HabitDaySummary;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubNetwork() {
  serverDay = { date: TODAY, habits: [stretch, water, sauna] };
  homeHabits = summary(0);
  profile = { timezone: "UTC", logsOpenFrom: null };
  fetchMock = vi.fn<Network>((url, init) => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      return new Promise<Response>((resolve, reject) => {
        pending = {
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
          respond: (status, body) => resolve(reply(status, body)),
          lose: () => reject(new TypeError("Failed to fetch")),
        };
      });
    }
    if (url === "/api/client/me") return Promise.resolve(reply(200, { success: true, data: profile }));
    if (url === DAY_URL) return Promise.resolve(reply(200, { success: true, data: serverDay }));
    if (url === SUMMARY_URL) return Promise.resolve(reply(200, daySummary(homeHabits)));
    if (url === YESTERDAY_SUMMARY_URL) return Promise.resolve(reply(200, daySummary(yesterdaySummary)));
    return Promise.reject(new Error(`unexpected read ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
}

const reads = (url: string) => fetchMock.mock.calls.filter(([called, init]) => called === url && (init?.method ?? "GET") === "GET").length;

/** One habit's row as the page shows it. */
function rowState(id: string) {
  const control = document.getElementById(`habit-${id}`);
  const row = control?.closest(".py-3");
  if (!control || !row) return null;
  return {
    group: row.closest("section")?.getAttribute("aria-label") ?? null,
    ticked: control.getAttribute("data-state") === "checked",
    number: control instanceof HTMLInputElement ? control.value : null,
    done: row.querySelector('[aria-label="Done"]') !== null,
    week: Array.from(row.querySelectorAll("span")).find((span) => /this week$/.test(span.textContent ?? ""))?.textContent ?? null,
    note: row.querySelector<HTMLInputElement>('input[aria-label^="Note for"]')?.value ?? null,
    disabled: control.hasAttribute("disabled"),
  };
}

type Frame = {
  loading: boolean;
  /** The day's lock notice is on screen. */
  locked: boolean;
  stretch: ReturnType<typeof rowState>;
  sauna: ReturnType<typeof rowState>;
  water: ReturnType<typeof rowState>;
  /** The home's day: what its header names. */
  homeDay: string | null;
  /** The home's habits card: what its row leads with. */
  homeHabits: string | null;
};
let frames: Frame[] = [];

function snapshot(): Frame {
  return {
    loading: document.querySelectorAll('[data-slot="skeleton"]').length > 0,
    locked: Array.from(document.querySelectorAll('[role="status"]')).some((node) => node.textContent === "This day is locked."),
    stretch: rowState("Stretch"),
    sauna: rowState("Sauna"),
    water: rowState("Water"),
    homeDay: document.querySelector('[aria-live="polite"]')?.textContent ?? null,
    homeHabits: document.querySelector('a[aria-label^="Habits"]')?.querySelector(".text-sm")?.textContent ?? null,
  };
}

type Route = "home" | "habits" | null;

/** The app: one SWR cache for every page, kept across a page closing and the next opening. */
function tree(cache: Cache, route: Route): ReactNode {
  return (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <Profiler id="client" onRender={() => frames.push(snapshot())}>
        {route === "home" ? <ClientHomePage /> : route === "habits" ? <HabitsPage /> : null}
      </Profiler>
    </SWRConfig>
  );
}

let cache: Cache;

async function openHabits() {
  address.date = TODAY;
  const view = render(tree(cache, "habits"));
  await screen.findByText("Stretch", { selector: "label" });
  return view;
}

/** Answers the write in flight and lets every commit land; `frames` then holds the answer's commits alone. */
async function answer(status: number, body: unknown) {
  frames = [];
  await act(async () => {
    pending?.respond(status, body);
    await Promise.resolve();
  });
}

const result = (item: ClientHabitDayItem, day: Partial<HabitDayFacts>, met: number): HabitEntryResult => ({
  day: { ...item.day, ...day },
  week: { ...item.week, done: met, met },
});

const noteButton = (id: string) =>
  within(document.getElementById(`habit-${id}`)!.closest(".py-3") as HTMLElement).getByRole("button", { name: `Add a note to ${id}` });

beforeEach(() => {
  // Only the clock is fixed: the device's today and the client's are the plan's Tuesday.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
  vi.clearAllMocks();
  cache = new Map() as unknown as Cache;
  frames = [];
  pending = null;
  address.date = null;
  address.replaced = [];
  stubNetwork();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("an entry changes its row in place", () => {
  it("a tick: ticked and its week moved from the click on, the answer landing the same, never back, never loading, never regrouped", async () => {
    await openHabits();
    const user = userEvent.setup();
    frames = [];
    await user.click(screen.getByRole("checkbox", { name: "Sauna" }));

    expect(pending?.body).toEqual({ done: true });
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.loading).toBe(false);
      expect(frame.sauna).toMatchObject({ group: "Any day this week", ticked: true, week: "3 of 3 this week" });
    }

    await answer(200, { success: true, data: result(sauna, { entry: { done: true, value: null, note: null }, met: true }, 3) });
    // The answer says what the click showed, so any commit it makes shows the same.
    for (const frame of frames) {
      expect(frame.loading).toBe(false);
      expect(frame.sauna).toMatchObject({ group: "Any day this week", ticked: true, week: "3 of 3 this week" });
    }
    expect(rowState("Sauna")).toMatchObject({ group: "Any day this week", ticked: true, week: "3 of 3 this week" });
    // The other habits never moved, and the day was not read again.
    expect(rowState("Stretch")).toMatchObject({ ticked: false, week: "1 of 7 this week" });
    expect(reads(DAY_URL)).toBe(1);
  });

  it("a number: the box keeps it from the moment it is left, met and its week moved at once by the kernel, the answer landing the same", async () => {
    await openHabits();
    const user = userEvent.setup();
    const box = screen.getByRole("textbox", { name: "Water" });
    await user.clear(box);
    await user.type(box, "3.5");
    frames = [];
    await user.tab();

    expect(pending?.body).toEqual({ value: 3.5 });
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.loading).toBe(false);
      expect(frame.water).toMatchObject({ group: "Planned today", number: "3.5", done: true, week: "4 of 7 this week" });
    }

    await answer(200, { success: true, data: result(water, { entry: { done: null, value: 3.5, note: null }, met: true }, 4) });
    for (const frame of frames) {
      expect(frame.water).toMatchObject({ number: "3.5", done: true, week: "4 of 7 this week" });
    }
    expect(rowState("Water")).toMatchObject({ number: "3.5", done: true, week: "4 of 7 this week" });
  });

  it("a note: the box opens from Add a note, and keeps the words from the moment it is left through the answer", async () => {
    await openHabits();
    const user = userEvent.setup();
    frames = [];
    await user.click(noteButton("Sauna"));
    // One commit opens the box, empty and ready.
    expect(frames.at(-1)?.sauna).toMatchObject({ note: "" });
    await user.type(screen.getByRole("textbox", { name: "Note for Sauna" }), "Gym closed");
    frames = [];
    await user.tab();

    expect(pending?.body).toEqual({ done: false, note: "Gym closed" });
    for (const frame of frames) {
      expect(frame.loading).toBe(false);
      expect(frame.sauna).toMatchObject({ ticked: false, note: "Gym closed", week: "2 of 3 this week" });
    }

    await answer(200, { success: true, data: result(sauna, { entry: { done: false, value: null, note: "Gym closed" } }, 2) });
    for (const frame of frames) {
      expect(frame.sauna).toMatchObject({ ticked: false, note: "Gym closed", week: "2 of 3 this week" });
    }
    expect(rowState("Sauna")?.note).toBe("Gym closed");
  });

  it("the coach stopped the habit underneath (409): the tick stays until the day is read, then the row is as the server has it, in one commit", async () => {
    await openHabits();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
    expect(rowState("Sauna")).toMatchObject({ ticked: true });

    // The day read the refusal asks for is held, so every commit up to it is the answer's own.
    let releaseRead: () => void = () => {};
    const held = new Promise<void>((resolve) => (releaseRead = resolve));
    const network = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, init) => (url === DAY_URL ? held.then(() => network(url, init)) : network(url, init)));

    await answer(409, { success: false, error: "That habit isn't running on that day." });
    await waitFor(() => expect(reads(DAY_URL)).toBe(2));
    // The read is still in flight: the row has not stepped back.
    for (const frame of frames) {
      expect(frame.loading).toBe(false);
      expect(frame.sauna).toMatchObject({ ticked: true, week: "3 of 3 this week" });
    }

    serverDay = { date: TODAY, habits: [stretch, water] };
    frames = [];
    await act(async () => {
      releaseRead();
      await held;
    });
    await waitFor(() => expect(rowState("Sauna")).toBeNull());
    // Straight from ticked to gone: no commit shows the row put back first.
    expect(frames.every((frame) => !frame.loading && (frame.sauna === null || frame.sauna.ticked))).toBe(true);
    expect(toast.error).toHaveBeenCalledWith("Couldn't update habit", { description: "That habit isn't running on that day." });
  });

  it("a second gesture on the same habit while the first is on its way: both show at once, and the second goes once the first has its answer", async () => {
    await openHabits();
    const user = userEvent.setup();
    await user.click(noteButton("Sauna"));
    await user.type(screen.getByRole("textbox", { name: "Note for Sauna" }), "Gym closed");
    frames = [];
    // Leaving the note for the tick: the note's save goes as the box blurs, the tick right after.
    await user.click(screen.getByRole("checkbox", { name: "Sauna" }));

    expect(pending?.body).toEqual({ done: false, note: "Gym closed" });
    expect(rowState("Sauna")).toMatchObject({ ticked: true, note: "Gym closed", week: "3 of 3 this week" });
    for (const frame of frames) expect(frame.loading).toBe(false);

    const first = pending;
    await answer(200, { success: true, data: result(sauna, { entry: { done: false, value: null, note: "Gym closed" } }, 2) });
    await waitFor(() => expect(pending).not.toBe(first));
    expect(pending?.body).toEqual({ done: true });
    for (const frame of frames) expect(frame.sauna).toMatchObject({ ticked: true, note: "Gym closed", week: "3 of 3 this week" });

    await answer(200, { success: true, data: result(sauna, { entry: { done: true, value: null, note: "Gym closed" }, met: true }, 3) });
    for (const frame of frames) expect(frame.sauna).toMatchObject({ ticked: true, note: "Gym closed", week: "3 of 3 this week" });
    expect(rowState("Sauna")).toMatchObject({ ticked: true, note: "Gym closed", week: "3 of 3 this week" });
  });
});

describe("an entry whose answer is not the plain one", () => {
  it("an answer lost on the way, the day read showing it saved: the tick stays, and nothing says it failed", async () => {
    await openHabits();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
    serverDay = {
      date: TODAY,
      habits: [stretch, water, { ...sauna, ...result(sauna, { entry: { done: true, value: null, note: null }, met: true }, 3), words: { ...sauna.words, week: "3 of 3" } }],
    };

    frames = [];
    await act(async () => {
      pending?.lose();
      await Promise.resolve();
    });
    await waitFor(() => expect(reads(DAY_URL)).toBe(2));
    await waitFor(() => expect(rowState("Sauna")).toMatchObject({ ticked: true, week: "3 of 3 this week" }));
    for (const frame of frames) expect(frame.sauna).toMatchObject({ ticked: true, week: "3 of 3 this week" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a locked day (403): the notice, the disabled controls and the row taken back arrive in one commit, the focus on the notice", async () => {
    await openHabits();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Sauna" }));
    // A check-in sent from another device closed today's week.
    profile = { timezone: "UTC", logsOpenFrom: "2999-01-01" };

    await answer(403, { success: false, error: "This day is locked." });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This day is locked", { description: "This day is locked." }));
    expect(frames.length).toBeGreaterThan(0);
    // A frame is locked exactly when the tick is taken back: never one without the other.
    for (const frame of frames) expect(frame.locked).toBe(frame.sauna?.ticked === false);
    expect(rowState("Sauna")).toMatchObject({ ticked: false, disabled: true });
    expect(document.activeElement?.textContent).toBe("This day is locked.");
  });

  it("an emptied number box: the number, its mark and its week go in one commit", async () => {
    const met = { ...water, day: { ...water.day, entry: { done: null, value: 3.5, note: null }, met: true }, week: { ...water.week, done: 4, met: 4 }, words: { ...water.words, week: "4 of 7" } };
    serverDay = { date: TODAY, habits: [stretch, met, sauna] };
    await openHabits();
    const user = userEvent.setup();
    await user.clear(screen.getByRole("textbox", { name: "Water" }));
    frames = [];
    await user.tab();

    expect(rowState("Water")).toMatchObject({ number: "", done: false, week: "3 of 7 this week" });
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      if (frame.water?.done) expect(frame.water).toMatchObject({ week: "4 of 7 this week" });
      else expect(frame.water).toMatchObject({ number: "", week: "3 of 7 this week" });
    }
  });
});

describe("a box refused goes back to what is saved", () => {
  it("a number: the box shows the saved number again in the commit the refusal lands", async () => {
    await openHabits();
    const user = userEvent.setup();
    const box = screen.getByRole("textbox", { name: "Water" });
    await user.clear(box);
    await user.type(box, "3.5");
    await user.tab();
    expect(rowState("Water")).toMatchObject({ number: "3.5", done: true });

    await answer(403, { success: false, error: "This day is locked." });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Never the refused number beside the saved entry: the box, the mark and the week agree.
    expect(rowState("Water")).toMatchObject({ number: "2", done: false, week: "3 of 7 this week" });
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.water).toMatchObject({ number: "2", done: false, week: "3 of 7 this week" });
    }
  });

  it("a note: the box shows the saved note again in the commit the refusal lands", async () => {
    await openHabits();
    const user = userEvent.setup();
    await user.click(noteButton("Sauna"));
    await user.type(screen.getByRole("textbox", { name: "Note for Sauna" }), "Gym closed");
    await user.tab();

    await answer(403, { success: false, error: "This day is locked." });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Sauna had no note: the refused words do not stay on screen as if saved.
    expect(rowState("Sauna")).toMatchObject({ note: null });
    for (const frame of frames) {
      expect(frame.sauna?.note).toBeNull();
    }
  });
});

describe("coming back to the home after an entry", () => {
  /** Ticks Stretch on the habits page, the server answering, its home count moving to 1 of 2. */
  async function tickStretchFrom(view: ReturnType<typeof render>) {
    address.date = TODAY;
    view.rerender(tree(cache, "habits"));
    await screen.findByText("Stretch", { selector: "label" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Stretch" }));
    homeHabits = summary(1);
    await answer(200, { success: true, data: result(stretch, { entry: { done: true, value: null, note: null }, met: true }, 2) });
    await waitFor(() => expect(rowState("Stretch")?.week).toBe("2 of 7 this week"));
  }

  it("shows the card's placeholder until the new count lands, never the count from before", async () => {
    // The home first: Stretch and Water planned, neither done.
    const view = render(tree(cache, "home"));
    await waitFor(() => expect(snapshot().homeHabits).toBe("0 of 2 done today"));

    await tickStretchFrom(view);

    // Back to the home.
    frames = [];
    address.date = null;
    view.rerender(tree(cache, "home"));
    await waitFor(() => expect(snapshot().homeHabits).toBe("1 of 2 done today"));
    expect(frames.some((frame) => frame.homeHabits === "0 of 2 done today")).toBe(false);
    expect(frames[0]).toMatchObject({ loading: true, homeHabits: null });
    expect(reads(SUMMARY_URL)).toBe(2);
  });

  it("going back before the answer: the card holds its place until the count that counts the entry", async () => {
    const view = render(tree(cache, "home"));
    await waitFor(() => expect(snapshot().homeHabits).toBe("0 of 2 done today"));
    address.date = TODAY;
    view.rerender(tree(cache, "habits"));
    await screen.findByText("Stretch", { selector: "label" });
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Stretch" }));

    // Home again, the tick still on its way.
    frames = [];
    address.date = null;
    view.rerender(tree(cache, "home"));
    homeHabits = summary(1);
    await act(async () => {
      pending?.respond(200, { success: true, data: result(stretch, { entry: { done: true, value: null, note: null }, met: true }, 2) });
      await Promise.resolve();
    });
    await waitFor(() => expect(snapshot().homeHabits).toBe("1 of 2 done today"));
    expect(frames.some((frame) => frame.homeHabits === "0 of 2 done today")).toBe(false);
    // One read of the day after the entry, made once it had settled.
    expect(reads(SUMMARY_URL)).toBe(2);
  });

  it("a move to a day already seen shows its placeholder, then that day: never the day just left under the new date", async () => {
    // Yesterday, then today, on the home: both days read and cached.
    address.date = YESTERDAY;
    const view = render(tree(cache, "home"));
    await waitFor(() => expect(snapshot()).toMatchObject({ homeDay: "Yesterday", homeHabits: "0 of 1 done" }));
    address.date = null;
    view.rerender(tree(cache, "home"));
    await waitFor(() => expect(snapshot()).toMatchObject({ homeDay: "Today", homeHabits: "0 of 2 done today" }));

    await tickStretchFrom(view);
    address.date = null;
    view.rerender(tree(cache, "home"));
    await waitFor(() => expect(snapshot().homeHabits).toBe("1 of 2 done today"));

    // Back a day: the arrow replaces the address, and the move commits.
    const user = userEvent.setup();
    frames = [];
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(address.replaced.at(-1)).toBe(`/client?date=${YESTERDAY}`);
    address.date = YESTERDAY;
    view.rerender(tree(cache, "home"));
    await waitFor(() => expect(snapshot()).toMatchObject({ homeDay: "Yesterday", homeHabits: "0 of 1 done" }));

    const underYesterday = frames.filter((frame) => frame.homeDay === "Yesterday");
    expect(underYesterday.length).toBeGreaterThan(0);
    for (const frame of underYesterday) expect([null, "0 of 1 done"]).toContain(frame.homeHabits);
    // The day was cleared with the entry, so its card waited for a fresh read.
    expect(underYesterday[0]).toMatchObject({ loading: true, homeHabits: null });
    expect(reads(YESTERDAY_SUMMARY_URL)).toBe(2);
  });
});
