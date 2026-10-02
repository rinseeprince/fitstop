"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig, type Cache } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { useClearClientDaySummaries } from "@/hooks/use-client-training-data";
import {
  CLIENT_HABITS_AREA,
  refusedByChange,
  refusedOutright,
  sendHabitEntry,
  useClearClientHabitReads,
  useHabitEntryLine,
  useReadAfterHabitEntries,
} from "@/hooks/use-client-habit-entries";
import { isClientHabitDayKey } from "@/hooks/use-client-portal-habits";
import { sameEntry } from "@/lib/habits/habit-entry-ledger";
import { answerLandsAlone, weekWithDay, weekWithEntry, weekWithRow } from "@/lib/habits/habit-week-changes";
import type { ClientHabitWeek, HabitAnswer, HabitDayFacts, HabitEntryResult, HabitWeekRow } from "@/types/habits";

// The check-in's Habits step (docs/HABITS-REBUILD-PLAN.md §6, commit 6): the
// habit week over the check-in's period, read under one key and no other
// (CONVENTIONS §7), and the client's entries made from it. Its invalidator is
// the client habit area's (`useClearClientHabitReads`, whose matcher this key
// falls under).

/** The check-in's habit week: the habit week read over the check-in's period, dates inside one client week. */
export function checkInHabitWeekKey(start: string, end: string): string {
  return `${CLIENT_HABITS_AREA}/week?start=${start}&end=${end}`;
}

// No deduping: the week is read every time the step comes on screen, a Back
// and a Next a second apart included, so it shows what the server holds now.
const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 0,
} as const;

type WeekResponse = { success: boolean; data: ClientHabitWeek };

/** A change the client made on the step: one habit's entry on one day, a tick, a number or none. */
type Change = { habitId: string; date: string; entry: HabitDayFacts["entry"] };

/**
 * The step's changes on their way to the server, oldest first, shown over the
 * week the server last gave until each one's write settles, and the step's
 * reads of the week that are out. An external store rather than component
 * state: a change leaving it and its answer landing in the week's cache are
 * then two store updates in one tick, which React renders as one commit, so no
 * frame shows the answer with the change still laid over it, or neither.
 */
class StepLedger {
  private changes: readonly Change[] = [];
  private readonly reads = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.changes;

  add(change: Change): void {
    this.changes = [...this.changes, change];
    this.emit();
  }

  remove(change: Change): void {
    this.changes = this.changes.filter((each) => each !== change);
    this.emit();
  }

  /** A read of `key` going out. Pair with `readEnded`. */
  readStarted(key: string): void {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
  }

  readEnded(key: string): void {
    const out = (this.reads.get(key) ?? 1) - 1;
    if (out > 0) this.reads.set(key, out);
    else this.reads.delete(key);
  }

  /** Whether a read of `key` is out: SWR's own flag is cleared when an overtaken read fails, though a newer one is out. */
  isReading(key: string): boolean {
    return this.reads.has(key);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

// One per SWR cache, as the habits page's ledger is: a write outlives the step
// that made it, as the cache it lands in does, so a client who goes Back while
// a write is on its way finds it still shown when they come Next again.
const ledgers = new WeakMap<Cache, StepLedger>();

function ledgerFor(cache: Cache): StepLedger {
  const found = ledgers.get(cache);
  if (found) return found;
  const ledger = new StepLedger();
  ledgers.set(cache, ledger);
  return ledger;
}

/** The habit's row in a week read, or null when it no longer lists the habit. */
const rowOf = (week: ClientHabitWeek, habitId: string): HabitWeekRow | null =>
  week.habits.find((row) => row.habit.id === habitId) ?? null;

/**
 * Whether the day as read holds what a write asked for: its answer, or no
 * entry for a clear. The note is whatever the day has: the step sends none,
 * and one made meanwhile on another screen does not make the write unsaved.
 */
const holdsWrite = (day: HabitDayFacts, entry: HabitDayFacts["entry"]) =>
  sameEntry(day.entry, entry === null ? null : { ...entry, note: day.entry?.note ?? null });

/**
 * The check-in's habit week and the client's entries on it. `initial` is the
 * week the check-in context answered with: the check-in page puts it in the
 * cache on each visit (`useClientCheckIn`), and the read shows it until the
 * cache holds a week. The week is read again every time the step comes on
 * screen, once every habit entry on its way has its answer; between reads,
 * the cache and the changes on their way keep the step as the client left it
 * through Back and Next.
 *
 * `save` records a tick habit's done or not, or a number habit's number, and
 * keeps the day's note; `clear` removes the entry, its note with it. A change
 * shows at once — its day, its habit's figures moved by that day alone, and
 * the totals — and stays until its own write settles; a habit's writes go one
 * after another in the line the habits page shares, whatever day each is for.
 * Making a change clears the client's other habit reads and the home's day
 * summaries, none of them on screen beside the step. The Journey and the day
 * summaries read again once the entries on their way have their answers; the
 * habits page's day, opened while the write is out, shows the day as the
 * server has it, and is read again in place when the write settles.
 * When a write settles:
 * - saved: the habit's day lands as the answer has it, its figures moved by
 *   that day over the step's own dates — when the answer vouches for that
 *   (`answerLandsAlone`): its day planned as the step holds it, and its whole
 *   week counting what the moved row counts. Otherwise — the coach changed
 *   the habit underneath, or the step holds a first week clamped to the start
 *   day, which the answer's whole week cannot vouch for — the week is read
 *   again, as below;
 * - refused (400, 403): the change goes, and the day shows what it had;
 * - the habit deleted or stopped underneath it (404, 409), a 5xx, or no answer
 *   at all: the week is read straight from the server and the habit lands as
 *   it has it — or leaves the step — with the change dropped in the same
 *   commit; after a 5xx or no answer, a read that shows the entry saved
 *   settles the write as saved;
 * - saved but not read back: the change is what the server holds, and the
 *   week is read again for the rest.
 * A landing that would overtake a read of the week still out asks for another
 * (SWR throws away a read that started before a change of its key). Every
 * settle refreshes the habits page's day reads, in case it was opened while
 * the write was on its way. Each write settles to undefined, or rejects with
 * the server's `HabitEntryError` or what `fetch` threw.
 */
export function useCheckInHabitWeek(initial: ClientHabitWeek) {
  const key = checkInHabitWeekKey(initial.start, initial.end);
  const { cache, mutate } = useSWRConfig();
  const ledger = ledgerFor(cache);
  const onTheWay = useSyncExternalStore(ledger.subscribe, ledger.snapshot, ledger.snapshot);
  const line = useHabitEntryLine();
  const clearHabitReads = useClearClientHabitReads();
  const clearDaySummaries = useClearClientDaySummaries();
  // A read of the week waits for every habit entry on its way — the habits
  // page's too — so it never lands a figure from before one; the ledger counts
  // it while it is out.
  const readAfterEntries = useReadAfterHabitEntries(swrFetcher);
  const fetchWeek = useCallback(
    async (url: string) => {
      ledger.readStarted(url);
      try {
        return (await readAfterEntries(url)) as WeekResponse;
      } finally {
        ledger.readEnded(url);
      }
    },
    [ledger, readAfterEntries]
  );

  const fallbackData = useMemo<WeekResponse>(() => ({ success: true, data: initial }), [initial]);
  const { data } = useSWR<WeekResponse>(key, fetchWeek, {
    ...SWR_CONFIG,
    fallbackData,
    onError: (err) => console.error("[check-in] habit week fetch failed:", err),
  });
  const confirmed = data?.data ?? initial;
  const week = useMemo(
    () => onTheWay.reduce((shown, change) => weekWithEntry(shown, change.habitId, change.date, change.entry), confirmed),
    [onTheWay, confirmed]
  );

  const write = useCallback(
    (row: HabitWeekRow, date: string, entry: HabitDayFacts["entry"], send: () => Promise<HabitEntryResult | null>) => {
      const habitId = row.habit.id;
      const change: Change = { habitId, date, entry };
      /** The week as the cache holds it, the server's: the step's first answer while it holds none. */
      const held = () => (cache.get(key)?.data as WeekResponse | undefined)?.data ?? initial;

      /**
       * The change leaves and the week moves, in one commit. A read of the
       * week out now started before this landing, and SWR will throw it away
       * when it returns: the landing asks for another.
       */
      const land = (update: (current: ClientHabitWeek) => ClientHabitWeek) => {
        ledger.remove(change);
        void mutate<WeekResponse>(key, (current) => ({ success: true, data: update(current?.data ?? initial) }), {
          revalidate: ledger.isReading(key),
        });
      };

      /**
       * The week as the server has it, read straight from it, and the habit
       * landed as that read has it, the change dropped in the same commit.
       * Only this habit's row is taken from the read: another habit's answer
       * may have landed while it was out, and this habit's next write waits
       * in line for this one. Answers whether the read shows what the change
       * asked for; null when it could not be read, in which case the change is
       * dropped all the same and the week is asked for again.
       */
      const reconcile = async (): Promise<boolean | null> => {
        let fresh: ClientHabitWeek | null = null;
        try {
          fresh = ((await swrFetcher(key)) as WeekResponse).data;
        } catch (error) {
          console.error("[check-in] habit week re-read failed:", error);
        }
        if (fresh === null) {
          ledger.remove(change);
          void mutate(key);
          return null;
        }
        const freshRow = rowOf(fresh, habitId);
        land((current) => weekWithRow(current, habitId, freshRow));
        const day = freshRow?.days.find((each) => each.date === date);
        return day !== undefined && holdsWrite(day, entry);
      };

      ledger.add(change);
      // What the entry moves elsewhere, cleared as it is made: none of those
      // reads is on screen beside the step.
      void clearHabitReads((other) => other === key);
      void clearDaySummaries();
      return line(habitId, async () => {
        try {
          let result: HabitEntryResult | null;
          try {
            result = await send();
          } catch (error) {
            if (refusedOutright(error)) {
              ledger.remove(change);
              throw error;
            }
            // The habit changed underneath the write, or no certain answer came
            // back: the week as the server has it decides what shows — and,
            // without an answer, whether the entry was saved after all.
            const saved = await reconcile();
            if (saved === true && !refusedByChange(error)) return;
            throw error;
          }
          if (result) {
            const answer = result;
            if (answerLandsAlone(held(), habitId, answer)) {
              land((current) => weekWithDay(current, habitId, answer.day));
            } else {
              // Saved, but the answer's day alone cannot say how the habit
              // stands on the step's dates: the week read again does.
              await reconcile();
            }
          } else {
            // Saved, but not read back: the change is what the server holds,
            // and the week read again says the rest.
            land((current) => weekWithEntry(current, habitId, date, entry));
            void mutate(key);
          }
        } finally {
          // The habits page, opened while the write was on its way, reads its
          // day again in place: its rows stay, and its own changes with them.
          void mutate(isClientHabitDayKey);
        }
      });
    },
    [cache, ledger, line, mutate, key, initial, clearHabitReads, clearDaySummaries]
  );

  const save = useCallback(
    (row: HabitWeekRow, date: string, answer: HabitAnswer) => {
      const note = row.days.find((day) => day.date === date)?.entry?.note ?? null;
      const entry = {
        done: "done" in answer ? answer.done : null,
        value: "value" in answer ? answer.value : null,
        note,
      };
      // No note on the wire: the entry route keeps the day's note when none is sent.
      return write(row, date, entry, () => sendHabitEntry("PUT", row.habit.id, date, answer));
    },
    [write]
  );

  const clear = useCallback(
    (row: HabitWeekRow, date: string) => write(row, date, null, () => sendHabitEntry("DELETE", row.habit.id, date)),
    [write]
  );

  return { week, save, clear };
}
