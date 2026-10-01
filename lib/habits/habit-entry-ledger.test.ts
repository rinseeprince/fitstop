import { describe, it, expect } from "vitest";

import { HabitEntryLedger, sameEntry, withAnswer, withEntry, withHabit, withWeek, type ItemChange } from "./habit-entry-ledger";
import type { ClientHabitDay, ClientHabitDayItem } from "@/types/habits";

// The ledger of the client's habit entries on their way (commit 5): a day
// shows its own changes over what the server last gave, a habit's week shows
// every change on its way in that week, and a read refreshes either only when
// it started after it last moved.

const MON = "2026-09-28";
const TUE = "2026-09-29";
const WEEK = { start: "2026-09-24", end: "2026-09-30" };

function tick(id: string, date = TUE, done = 2): ClientHabitDayItem {
  return {
    habit: { id, name: id, howTo: null, measure: "tick", unit: null, direction: null },
    day: { date, covered: true, planned: true, target: null, edited: false, versionId: "v", timesPerWeek: null, entry: null, met: false },
    week: { planned: 7, done, met: done, ...WEEK },
    words: { schedule: "Every day", target: null, week: `${done} of 7` },
  };
}

const water: ClientHabitDayItem = {
  habit: { id: "water", name: "Water", howTo: null, measure: "number", unit: "L", direction: "at_least" },
  day: { date: TUE, covered: true, planned: true, target: 3, edited: false, versionId: "w", timesPerWeek: null, entry: null, met: false },
  week: { planned: 7, done: 3, met: 3, ...WEEK },
  words: { schedule: "Every day", target: "at least 3 L", week: "3 of 7" },
};

const done: ItemChange = (item) => withEntry(item, { done: true, value: null, note: null });
const noted: ItemChange = (item) => withEntry(item, { done: item.day.entry?.done === true, value: null, note: "Rain" });
const week = (n: number) => ({ planned: 7, done: n, met: n, ...WEEK });

/** A ledger whose weeks are recorded from a read of each item, as the day reads do. */
function ledgerOver(...items: ClientHabitDayItem[]) {
  const ledger = new HabitEntryLedger();
  const startedAt = ledger.stamp();
  for (const date of new Set(items.map((item) => item.day.date))) {
    ledger.overlay({ date, habits: items.filter((item) => item.day.date === date) }, startedAt);
  }
  return ledger;
}

describe("an item's changes", () => {
  it("an entry judges the day by the kernel against the day's target", () => {
    expect(withEntry(water, { done: null, value: 3.5, note: null }).day).toMatchObject({ entry: { value: 3.5 }, met: true });
    expect(withEntry(water, { done: null, value: 2, note: null }).day.met).toBe(false);
    expect(withEntry(withEntry(water, { done: null, value: 4, note: null }), null).day).toMatchObject({ entry: null, met: false });
  });

  it("an answer gives the day and the week, and the target's words from that day's target", () => {
    const answered = withAnswer(water, {
      day: { ...water.day, target: 2, entry: { done: null, value: 2.5, note: null }, met: true },
      week: week(4),
    });
    expect(answered.words).toEqual({ schedule: "Every day", target: "at least 2 L", week: "4 of 7" });
  });

  it("a week lands on the days of that week alone", () => {
    expect(withWeek(tick("walk"), week(5))).toMatchObject({ week: week(5), words: { week: "5 of 7" } });
    const nextWeek = { ...tick("walk"), week: { planned: 7, done: 0, met: 0, start: "2026-10-01", end: "2026-10-07" } };
    expect(withWeek(nextWeek, week(5))).toBe(nextWeek);
  });

  it("a day takes one habit's item, or leaves it out, every other habit as it is", () => {
    const day: ClientHabitDay = { date: TUE, habits: [tick("walk"), tick("read")] };
    expect(withHabit(day, "walk", done).habits.map((item) => item.day.met)).toEqual([true, false]);
    expect(withHabit(day, "walk", done).habits[1]).toBe(day.habits[1]);
    expect(withHabit(day, "walk", () => null).habits.map((item) => item.habit.id)).toEqual(["read"]);
  });

  it("two entries are the same when their answer and note are", () => {
    expect(sameEntry(null, null)).toBe(true);
    expect(sameEntry({ done: true, value: null, note: "a" }, { done: true, value: null, note: "a" })).toBe(true);
    expect(sameEntry({ done: true, value: null, note: "a" }, { done: true, value: null, note: null })).toBe(false);
    expect(sameEntry({ done: true, value: null, note: null }, null)).toBe(false);
  });
});

describe("the ledger", () => {
  it("shows a day's changes in order over what is confirmed, and its week moved by that day", () => {
    const ledger = ledgerOver(tick("walk"));
    ledger.open(tick("walk"));
    ledger.add(TUE, "walk", done);
    ledger.add(TUE, "walk", noted);
    expect(ledger.shown(TUE, tick("walk"))).toMatchObject({ day: { entry: { done: true, note: "Rain" }, met: true }, words: { week: "3 of 7" } });

    // The first settles with its answer: the second still shows over it, and the week does not count the day twice.
    ledger.confirm(TUE, "walk", done);
    ledger.confirmWeek("walk", week(3));
    ledger.drop(TUE, "walk", done);
    expect(ledger.shown(TUE, tick("walk"))).toMatchObject({ day: { entry: { done: true, note: "Rain" } }, words: { week: "3 of 7" } });
  });

  it("moves a habit's week on every day of that week by every change on its way, whichever day it is on", () => {
    const ledger = ledgerOver(tick("walk", MON), tick("walk", TUE));
    ledger.open(tick("walk", MON));
    ledger.add(MON, "walk", done);
    // Tuesday, with no change of its own, shows Monday's on its way.
    expect(ledger.shown(TUE, tick("walk", TUE))?.week.done).toBe(3);
    ledger.open(tick("walk", TUE));
    ledger.add(TUE, "walk", done);
    expect(ledger.shown(MON, tick("walk", MON))?.week.done).toBe(4);
    expect(ledger.shown(TUE, tick("walk", TUE))?.week.done).toBe(4);
    // Another habit's week is its own.
    expect(ledger.shown(TUE, tick("read", TUE))?.week.done).toBe(2);
  });

  it("caps the week it shows at what was planned", () => {
    const ledger = ledgerOver({ ...tick("walk"), week: { planned: 2, done: 2, met: 2, ...WEEK } });
    ledger.open({ ...tick("walk"), week: { planned: 2, done: 2, met: 2, ...WEEK } });
    ledger.add(TUE, "walk", done);
    expect(ledger.shown(TUE, tick("walk"))?.week).toMatchObject({ planned: 2, done: 3, met: 2 });
  });

  it("closes a slot once it holds no change, and only then", () => {
    const ledger = ledgerOver(tick("walk"));
    ledger.open(tick("walk"));
    ledger.add(TUE, "walk", done);
    ledger.closeIfSettled(TUE, "walk");
    expect(ledger.has(TUE, "walk")).toBe(true);
    ledger.drop(TUE, "walk", done);
    ledger.closeIfSettled(TUE, "walk");
    expect(ledger.has(TUE, "walk")).toBe(false);
  });

  it("opens a slot once: a second open keeps what the first holds", () => {
    const ledger = ledgerOver(tick("walk"));
    ledger.open(tick("walk"));
    ledger.add(TUE, "walk", noted);
    ledger.open({ ...tick("walk"), day: { ...tick("walk").day, entry: { done: true, value: null, note: null }, met: true } });
    expect(ledger.shown(TUE, tick("walk"))?.day.entry).toEqual({ done: false, value: null, note: "Rain" });
  });

  it("a read refreshes a day and a week when it started after they last moved, never when something landed since", () => {
    const ledger = ledgerOver(tick("walk"));
    ledger.open(tick("walk"));
    ledger.add(TUE, "walk", noted);
    const later = ledger.stamp();
    ledger.confirmRead(TUE, "walk", { ...tick("walk"), day: { ...tick("walk").day, edited: true } }, later);
    ledger.confirmWeek("walk", week(4), later);
    expect(ledger.shown(TUE, tick("walk"))).toMatchObject({ day: { edited: true }, week: { done: 4 } });

    // Started before an answer landed: what the answer says stands.
    const before = ledger.stamp();
    ledger.confirm(TUE, "walk", (item) => ({ ...item, day: { ...item.day, target: 5 } }));
    ledger.confirmWeek("walk", week(5));
    ledger.confirmRead(TUE, "walk", tick("walk"), before);
    ledger.confirmWeek("walk", week(1), before);
    expect(ledger.shown(TUE, tick("walk"))).toMatchObject({ day: { edited: true, target: 5 }, week: { done: 5 } });
  });

  it("counts a change toward its own week alone", () => {
    const nextMonday = { ...tick("walk", "2026-10-05"), week: { planned: 7, done: 0, met: 0, start: "2026-10-01", end: "2026-10-07" } };
    const ledger = ledgerOver(tick("walk"), nextMonday);
    ledger.open(nextMonday);
    ledger.add("2026-10-05", "walk", done);
    expect(ledger.shown(TUE, tick("walk"))?.week.done).toBe(2);
    expect(ledger.shown("2026-10-05", nextMonday)?.week.done).toBe(1);
  });

  it("a slot opened after a read started is newer than that read", () => {
    const ledger = ledgerOver(tick("walk"));
    const startedAt = ledger.stamp();
    ledger.open(tick("walk"));
    ledger.add(TUE, "walk", noted);
    ledger.confirmRead(TUE, "walk", null, startedAt);
    expect(ledger.shown(TUE, tick("walk"))).not.toBeNull();
  });

  it("a read that no longer lists the habit takes it off the day, change and all", () => {
    const ledger = ledgerOver(tick("walk"));
    ledger.open(tick("walk"));
    ledger.add(TUE, "walk", done);
    ledger.confirmRead(TUE, "walk", null, ledger.stamp());
    expect(ledger.shown(TUE, tick("walk"))).toBeNull();
  });

  it("a change saved but not answered moves the day and its week by that day, as it showed", () => {
    const ledger = ledgerOver(tick("walk"));
    ledger.open(tick("walk"));
    ledger.add(TUE, "walk", done);
    const shownBefore = ledger.shown(TUE, tick("walk"));
    ledger.confirmChange(TUE, "walk", done);
    ledger.drop(TUE, "walk", done);
    expect(ledger.shown(TUE, tick("walk"))).toEqual(shownBefore);
  });

  it("lays every change on its way over a read of its day and of the other days of its week", () => {
    const ledger = ledgerOver(tick("walk", MON), tick("walk", TUE));
    ledger.open(tick("walk", TUE));
    ledger.add(TUE, "walk", done);
    const startedAt = ledger.stamp();
    const tuesday = ledger.overlay({ date: TUE, habits: [tick("walk", TUE, 4), tick("read", TUE)] }, startedAt);
    expect(tuesday.habits.map((item) => [item.habit.id, item.day.met, item.week.done])).toEqual([
      ["walk", true, 5],
      ["read", false, 2],
    ]);
    const monday = ledger.overlay({ date: MON, habits: [tick("walk", MON, 4)] }, ledger.stamp());
    expect(monday.habits[0].week.done).toBe(5);
    expect(ledger.overlay({ date: "2026-10-05", habits: [] }, ledger.stamp()).habits).toEqual([]);
  });

  it("an overlay leaves out a habit a newer read found gone, though an older read still lists it", () => {
    const ledger = ledgerOver(tick("walk"));
    ledger.open(tick("walk"));
    ledger.add(TUE, "walk", done);
    const older = ledger.stamp();
    ledger.confirmRead(TUE, "walk", null, ledger.stamp());
    const shown = ledger.overlay({ date: TUE, habits: [tick("walk"), tick("read")] }, older);
    expect(shown.habits.map((item) => item.habit.id)).toEqual(["read"]);
  });

  it("counts the reads of a day that are out", () => {
    const ledger = new HabitEntryLedger();
    ledger.readStarted(TUE);
    ledger.readStarted(TUE);
    ledger.readEnded(TUE);
    expect(ledger.isReading(TUE)).toBe(true);
    ledger.readEnded(TUE);
    expect(ledger.isReading(TUE)).toBe(false);
    expect(ledger.isReading(MON)).toBe(false);
  });
});

describe("a habit's line", () => {
  /** A write held until the test settles it. */
  function held() {
    let settle!: (fail?: boolean) => void;
    const promise = new Promise<string>((resolve, reject) => (settle = (fail) => (fail ? reject(new Error("refused")) : resolve("saved"))));
    return { promise, settle };
  }
  const tickOver = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("runs a habit's writes one after another, refused or not, and another habit's alongside", async () => {
    const ledger = new HabitEntryLedger();
    const started: string[] = [];
    const run = (name: string, write: ReturnType<typeof held>) => () => {
      started.push(name);
      return write.promise;
    };
    const first = held();
    const second = held();
    const other = held();
    const a = ledger.line("walk", run("walk 1", first));
    const b = ledger.line("walk", run("walk 2", second));
    const c = ledger.line("read", run("read 1", other));
    await tickOver();
    expect(started).toEqual(["walk 1", "read 1"]);

    first.settle(true);
    await expect(a).rejects.toThrow("refused");
    await tickOver();
    expect(started).toEqual(["walk 1", "read 1", "walk 2"]);

    second.settle();
    other.settle();
    expect(await Promise.all([b, c])).toEqual(["saved", "saved"]);
  });

  it("settles once every write in line now has settled", async () => {
    const ledger = new HabitEntryLedger();
    const first = held();
    const other = held();
    void ledger.line("walk", () => first.promise);
    void ledger.line("read", () => other.promise).catch(() => undefined);
    let settled = false;
    void ledger.settled().then(() => (settled = true));
    await tickOver();
    first.settle();
    await tickOver();
    expect(settled).toBe(false);
    other.settle(true);
    await tickOver();
    expect(settled).toBe(true);
    // Nothing in line: settled at once.
    await expect(new HabitEntryLedger().settled()).resolves.toBeUndefined();
  });
});
