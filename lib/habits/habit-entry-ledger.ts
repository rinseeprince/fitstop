import { entryMet } from "./habit-entry";
import { weekAfterDayChange } from "./habit-week";
import { targetWords, weekFigureWords } from "./habit-words";
import type { ClientHabitDay, ClientHabitDayItem, HabitDayFacts, HabitEntryResult, HabitWeekSpan } from "@/types/habits";

/**
 * The client's habit entries on their way to the server, and what the habits
 * page shows meanwhile (docs/HABITS-REBUILD-PLAN.md §6, commit 5). One habit
 * on one day is a slot: the day as the server last gave it (`confirmed`) and
 * the client's changes not yet settled, oldest first. A habit's week is a
 * record of its own, the server's latest figures for it. What the page shows
 * of a habit on any day is that day's changes applied over what is confirmed,
 * and the week moved by every change on its way in that week, whichever day
 * each is on — so a change shows at once on every day of its week, stays
 * until its own write settles, and a refused change takes nothing else with
 * it.
 *
 * Stamps order what the ledger has been told. A read takes one when it
 * starts; a slot or a week takes one whenever it changes. A read refreshes
 * either only when it started after it last changed, so a read that started
 * before an answer can never put back what the answer replaced.
 *
 * A habit's writes go one after another, whatever day each is for (`line`),
 * so each answer carries the habit's week as every earlier write left it.
 */

/** A change the client made: what it does to its habit's day. */
export type ItemChange = (item: ClientHabitDayItem) => ClientHabitDayItem;

/** A habit's item with a new entry on its day, judged by the kernel against the day's target. */
export function withEntry(item: ClientHabitDayItem, entry: HabitDayFacts["entry"]): ClientHabitDayItem {
  const met = entry !== null && entryMet(item.habit, entry, item.day.target);
  return { ...item, day: { ...item.day, entry, met } };
}

/** A habit's item as the entry write answered it: its day, its week, and the words for both. */
export function withAnswer(item: ClientHabitDayItem, result: HabitEntryResult): ClientHabitDayItem {
  return {
    ...item,
    day: result.day,
    week: result.week,
    words: { ...item.words, target: targetWords(item.habit, result.day.target), week: weekFigureWords(result.week) },
  };
}

/** A habit's item with its week; a day of another week stays as it is. */
export function withWeek(item: ClientHabitDayItem, week: HabitWeekSpan): ClientHabitDayItem {
  if (item.week.start !== week.start) return item;
  return { ...item, week, words: { ...item.words, week: weekFigureWords(week) } };
}

/** The day with one habit's item updated — or left out, when the update answers null. Every other habit as it is. */
export function withHabit(
  day: ClientHabitDay,
  habitId: string,
  update: (item: ClientHabitDayItem) => ClientHabitDayItem | null
): ClientHabitDay {
  return {
    ...day,
    habits: day.habits.flatMap((item) => {
      if (item.habit.id !== habitId) return [item];
      const next = update(item);
      return next === null ? [] : [next];
    }),
  };
}

/** Whether two entries say the same: the same answer and the same note, or none at all. */
export function sameEntry(a: HabitDayFacts["entry"], b: HabitDayFacts["entry"]): boolean {
  if (a === null || b === null) return a === b;
  return a.done === b.done && a.value === b.value && a.note === b.note;
}

type Slot = {
  /** The habit's day as the server last gave it; null when the day no longer lists it. */
  confirmed: ClientHabitDayItem | null;
  stamp: number;
  /** The changes made and not yet settled, oldest first. */
  changes: ItemChange[];
};

type WeekRecord = { week: HabitWeekSpan; stamp: number };

const changed = (slot: Slot): ClientHabitDayItem | null =>
  slot.confirmed === null ? null : slot.changes.reduce((item, change) => change(item), slot.confirmed);

export class HabitEntryLedger {
  private clock = 0;
  /** Each day's slots, by habit. */
  private readonly days = new Map<string, Map<string, Slot>>();
  /** Each habit's weeks as the server last gave them, by habit and week start. */
  private readonly weeks = new Map<string, WeekRecord>();
  /** Each habit's last write in line: the next waits for it to settle. */
  private readonly lines = new Map<string, Promise<void>>();
  /** How many reads of each day are out. */
  private readonly reading = new Map<string, number>();

  /** A stamp later than every stamp given before. */
  stamp(): number {
    this.clock += 1;
    return this.clock;
  }

  /** A read of the day going out: its stamp. Pair with `readEnded`. */
  readStarted(date: string): number {
    this.reading.set(date, (this.reading.get(date) ?? 0) + 1);
    return this.stamp();
  }

  readEnded(date: string): void {
    const out = (this.reading.get(date) ?? 1) - 1;
    if (out > 0) this.reading.set(date, out);
    else this.reading.delete(date);
  }

  /** Whether a read of the day is out. */
  isReading(date: string): boolean {
    return this.reading.has(date);
  }

  private slot(date: string, habitId: string): Slot | undefined {
    return this.days.get(date)?.get(habitId);
  }

  /** Whether the habit has a slot on the date: a change on its way, or a read of the day being settled. */
  has(date: string, habitId: string): boolean {
    return this.slot(date, habitId) !== undefined;
  }

  /**
   * Opens the habit's slot on `item.day.date` over the habit as the day read
   * holds it now — which then holds no change of its own on that day, so its
   * day is what the server has. A slot already open stays as it is.
   */
  open(item: ClientHabitDayItem): void {
    const date = item.day.date;
    if (this.has(date, item.habit.id)) return;
    const day = this.days.get(date) ?? new Map<string, Slot>();
    day.set(item.habit.id, { confirmed: item, stamp: this.stamp(), changes: [] });
    this.days.set(date, day);
  }

  /** A change made: shown from now on, after every change before it, until it is dropped. */
  add(date: string, habitId: string, change: ItemChange): void {
    this.slot(date, habitId)?.changes.push(change);
  }

  /** A change settled: no longer shown. */
  drop(date: string, habitId: string, change: ItemChange): void {
    const slot = this.slot(date, habitId);
    if (slot) slot.changes = slot.changes.filter((each) => each !== change);
  }

  /** What an answer says the server now has for the habit's day, built on what was confirmed. */
  confirm(date: string, habitId: string, update: (item: ClientHabitDayItem) => ClientHabitDayItem): void {
    const slot = this.slot(date, habitId);
    if (!slot) return;
    slot.confirmed = slot.confirmed === null ? null : update(slot.confirmed);
    slot.stamp = this.stamp();
  }

  /**
   * A change the server holds though no answer said how its week now stands
   * (saved, not read back): the day takes the change, and the habit's week
   * moves by that day alone, as it showed while the change was on its way.
   */
  confirmChange(date: string, habitId: string, change: ItemChange): void {
    const slot = this.slot(date, habitId);
    if (!slot || slot.confirmed === null) return;
    const before = slot.confirmed;
    const after = change(before);
    slot.confirmed = after;
    slot.stamp = this.stamp();
    const key = `${habitId}|${before.week.start}`;
    const week = this.weeks.get(key)?.week ?? before.week;
    this.weeks.set(key, { week: { ...week, ...weekAfterDayChange(week, before.day.met, after.day.met) }, stamp: this.stamp() });
  }

  /**
   * What a read that started at `startedAt` found for the habit's day (null:
   * the day no longer lists it). Kept only when nothing has changed the slot
   * since the read started: what landed meanwhile is newer.
   */
  confirmRead(date: string, habitId: string, item: ClientHabitDayItem | null, startedAt: number): void {
    const slot = this.slot(date, habitId);
    if (!slot || slot.stamp > startedAt) return;
    slot.confirmed = item;
    slot.stamp = startedAt;
  }

  /**
   * The habit's week as the server now has it: from an answer (no
   * `startedAt`), always; from a read that started at `startedAt`, only when
   * nothing newer has been recorded for that week since it started.
   */
  confirmWeek(habitId: string, week: HabitWeekSpan, startedAt?: number): void {
    const key = `${habitId}|${week.start}`;
    const recorded = this.weeks.get(key);
    if (startedAt !== undefined && recorded && recorded.stamp > startedAt) return;
    this.weeks.set(key, { week, stamp: startedAt ?? this.stamp() });
  }

  /**
   * The habit's week as the page shows it: the server's figures for that week
   * — `span`'s own when none is recorded — moved by each day's changes on
   * their way, every day of the week, by that day alone (`weekAfterDayChange`).
   */
  shownWeek(habitId: string, span: HabitWeekSpan): HabitWeekSpan {
    let week = this.weeks.get(`${habitId}|${span.start}`)?.week ?? span;
    for (const [date, slots] of this.days) {
      if (date < span.start || date > span.end) continue;
      const slot = slots.get(habitId);
      if (!slot || slot.confirmed === null || slot.changes.length === 0) continue;
      const after = changed(slot);
      if (after) week = { ...week, ...weekAfterDayChange(week, slot.confirmed.day.met, after.day.met) };
    }
    return week;
  }

  /**
   * The habit on `date` as the page should show it, given the item the day
   * read holds (`held`): its day as its changes leave it — `held` itself when
   * it has no slot — and its week as `shownWeek` has it; null when the server
   * no longer lists it on that day.
   */
  shown(date: string, held: ClientHabitDayItem): ClientHabitDayItem | null {
    const slot = this.slot(date, held.habit.id);
    const day = slot ? changed(slot) : held;
    if (day === null) return null;
    const week = this.shownWeek(held.habit.id, day.week);
    return { ...day, week, words: { ...day.words, week: weekFigureWords(week) } };
  }

  /** Closes the habit's slot on the date once it holds no change: the day read then holds what is confirmed. */
  closeIfSettled(date: string, habitId: string): void {
    const day = this.days.get(date);
    const slot = day?.get(habitId);
    if (!day || !slot || slot.changes.length > 0) return;
    day.delete(habitId);
    if (day.size === 0) this.days.delete(date);
  }

  /**
   * A day as a read that started at `startedAt` found it, with every change
   * still on its way laid over it: each slot and each week is refreshed by the
   * read (`confirmRead`, `confirmWeek`), then each habit shown, so a read never
   * wipes a change in flight, on its own day or another day of its week.
   */
  overlay(read: ClientHabitDay, startedAt: number): ClientHabitDay {
    for (const item of read.habits) this.confirmWeek(item.habit.id, item.week, startedAt);
    const slots = this.days.get(read.date);
    for (const habitId of Array.from(slots?.keys() ?? [])) {
      this.confirmRead(read.date, habitId, read.habits.find((item) => item.habit.id === habitId) ?? null, startedAt);
    }
    return {
      ...read,
      habits: read.habits.flatMap((item) => {
        const shown = this.shown(read.date, item);
        return shown === null ? [] : [shown];
      }),
    };
  }

  /**
   * Runs one of a habit's writes once every earlier write of that habit has
   * settled, refused or not. The caller is handed the write's own outcome.
   */
  line<T>(habitId: string, run: () => Promise<T>): Promise<T> {
    const next = (this.lines.get(habitId) ?? Promise.resolve()).then(run);
    // The line waits for the write to settle either way; its outcome is the caller's.
    const settled = next.then(
      () => undefined,
      () => undefined
    );
    this.lines.set(habitId, settled);
    void settled.then(() => {
      if (this.lines.get(habitId) === settled) this.lines.delete(habitId);
    });
    return next;
  }

  /** Settles once every write in line now, of every habit, has settled. */
  async settled(): Promise<void> {
    await Promise.all(Array.from(this.lines.values()));
  }
}
