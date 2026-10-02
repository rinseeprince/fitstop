"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig, type Cache } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { useClearClientDaySummaries } from "@/hooks/use-client-training-data";
import {
  CLIENT_HABITS_AREA,
  habitEntryLedger,
  refusedByChange,
  refusedOutright,
  sendHabitEntry,
  useClearClientHabitReads,
  useReadAfterHabitEntries,
} from "@/hooks/use-client-habit-entries";
import { CLIENT_PROFILE_KEY } from "@/lib/client-profile-key";
import {
  sameEntry,
  withAnswer,
  withEntry,
  withHabit,
  type HabitEntryLedger,
  type ItemChange,
} from "@/lib/habits/habit-entry-ledger";
import type {
  ClientHabitDay,
  ClientHabitDayItem,
  ClientHabitProgress,
  HabitAnswer,
  HabitEntryResult,
  HabitWeekSpan,
} from "@/types/habits";

// The habits page's day and the Journey's weeks (docs/HABITS-REBUILD-PLAN.md
// §2.4). Key construction lives here and nowhere else (CONVENTIONS §7): the
// habits page reads its day under one key, the Journey its weeks under
// another. The page's day read and its entries are one hook: SWR's day cache
// is the one store the page shows, and every change to it is one mutate. The
// entry write, its line and the area's invalidator are the client's for every
// screen (`use-client-habit-entries.ts`).

const DAY_KEY_PREFIX = `${CLIENT_HABITS_AREA}/day?date=`;

/** Every habit a version covers on `date`, with the day, the week holding it and the words. */
export function clientHabitDayKey(date: string): string {
  return `${DAY_KEY_PREFIX}${date}`;
}

/** The Journey's habits: the last `weeks` client weeks and the last days as they happened. */
export function clientHabitProgressKey(weeks: number): string {
  return `${CLIENT_HABITS_AREA}/progress?weeks=${weeks}`;
}

/** The date a day read is for, or null for any other key. */
function habitDayKeyDate(key: unknown): string | null {
  return typeof key === "string" && key.startsWith(DAY_KEY_PREFIX) ? key.slice(DAY_KEY_PREFIX.length) : null;
}

/** Pure matcher for the habits page's day reads (`clientHabitDayKey`), any date. */
export function isClientHabitDayKey(key: unknown): boolean {
  return habitDayKeyDate(key) !== null;
}

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 2000,
} as const;

type DayResponse = { success: boolean; data: ClientHabitDay };

/** The Journey's habits over the last `weeks` client weeks; `retrying` while a read follows a failed one. */
export function useClientHabitProgress(weeks: number) {
  const fetchProgress = useReadAfterHabitEntries(swrFetcher);
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ success: boolean; data: ClientHabitProgress }>(
    clientHabitProgressKey(weeks),
    fetchProgress,
    { ...SWR_CONFIG, onError: (err) => console.error("[habits] progress fetch failed:", err) }
  );
  const retry = useCallback(() => void mutate(), [mutate]);
  return { progress: data?.data ?? null, error, isLoading, retrying: Boolean(error) && isValidating, retry };
}

/**
 * Reads a day from the server, every change still on its way laid over it.
 * The ledger counts the read while it is out: SWR's own flag is cleared when
 * an overtaken read fails, though a newer one is still out.
 */
async function readDay(ledger: HabitEntryLedger, url: string): Promise<DayResponse> {
  const date = habitDayKeyDate(url) ?? "";
  const startedAt = ledger.readStarted(date);
  try {
    const response = (await swrFetcher(url)) as DayResponse;
    return { ...response, data: ledger.overlay(response.data, startedAt) };
  } finally {
    ledger.readEnded(date);
  }
}

type EntryEnv = {
  cache: Cache;
  mutate: ReturnType<typeof useSWRConfig>["mutate"];
  ledger: HabitEntryLedger;
  clearHabitReads: ReturnType<typeof useClearClientHabitReads>;
  clearDaySummaries: () => unknown;
};

/** The entry writes for the habits on `date`: `save` and `clear`. */
function entryWrites({ cache, mutate, ledger, clearHabitReads, clearDaySummaries }: EntryEnv, date: string) {
  /**
   * A change to a day read, in one commit. A day the cache holds no data for
   * has nothing on screen to change: a read out for it is asked again, so
   * what it lands is read after the change. A read out for a day the cache
   * holds would be thrown away by SWR once the change lands (a read that
   * started before a change of its key is discarded, and SWR asks again only
   * when told to), so the change asks for another.
   */
  const landOn = (key: string, day: string, apply: (current: ClientHabitDay) => ClientHabitDay) => {
    const reading = ledger.isReading(day);
    if (cache.get(key)?.data === undefined) {
      if (reading) void mutate(key);
      return;
    }
    void mutate<DayResponse>(key, (current) => (current ? { ...current, data: apply(current.data) } : current), {
      revalidate: reading,
    });
  };

  /** The day reads the cache holds for the days of a week. */
  const daysOf = (week: Pick<HabitWeekSpan, "start" | "end">) =>
    Array.from(cache.keys()).flatMap((key) => {
      const day = habitDayKeyDate(key);
      return day !== null && day >= week.start && day <= week.end ? [{ key, day }] : [];
    });

  /**
   * Lands the habit as the ledger shows it on every day of its week a day
   * read holds — its own day's changes, and its week as every change on its
   * way leaves it — then closes the slot of a day left with no change.
   */
  const landHabit = (habitId: string, week: Pick<HabitWeekSpan, "start" | "end">) => {
    for (const { key, day } of daysOf(week)) {
      landOn(key, day, (current) => withHabit(current, habitId, (held) => ledger.shown(day, held)));
      ledger.closeIfSettled(day, habitId);
    }
  };

  /**
   * The reads an entry moves that no day read carries — the Journey, the
   * habit week and every home day summary — CLEARED, not merely revalidated
   * (CONVENTIONS §7): each states a figure. Their reads wait for the entries
   * on their way (`useReadAfterHabitEntries`). A day read is never cleared:
   * the page on screen would unmount its rows.
   */
  const clearAround = () => {
    void clearHabitReads(isClientHabitDayKey);
    void clearDaySummaries();
  };

  /** The habit as the day read holds it now, if it holds it. */
  const heldItem = (day: string, habitId: string): ClientHabitDayItem | undefined =>
    (cache.get(clientHabitDayKey(day))?.data as DayResponse | undefined)?.data.habits.find((item) => item.habit.id === habitId);

  /**
   * Reads the habit's day straight from the server and lands the habit as the
   * server has it — or without it, when the day no longer lists it — with
   * `change` dropped, in one landing on every day of its week. Answers
   * whether the server now holds what `change` asked for (true when there is
   * no change to judge); null when the day could not be read, in which case
   * the change is dropped all the same and every day read of the week asks
   * again.
   */
  const reconcile = async (day: string, habitId: string, week: Pick<HabitWeekSpan, "start" | "end">, change: ItemChange | null) => {
    const held = heldItem(day, habitId);
    if (held) ledger.open(held);
    const startedAt = ledger.stamp();
    let fresh: ClientHabitDayItem | null | undefined;
    try {
      const read = ((await swrFetcher(clientHabitDayKey(day))) as DayResponse).data;
      fresh = read.habits.find((each) => each.habit.id === habitId) ?? null;
    } catch (error) {
      console.error("[habits] day re-read failed:", error);
    }
    if (fresh !== undefined) {
      ledger.confirmRead(day, habitId, fresh, startedAt);
      if (fresh) ledger.confirmWeek(habitId, fresh.week, startedAt);
    }
    if (change) ledger.drop(day, habitId, change);
    landHabit(habitId, week);
    if (fresh === undefined) {
      for (const each of daysOf(week)) void mutate(each.key);
      return null;
    }
    return change === null || (fresh !== null && sameEntry(change(fresh).day.entry, fresh.day.entry));
  };

  /** The client's day rule, read again after a 403, landed in the same tick as `land` so the lock and the row arrive together. */
  const withDayRule = async (land: () => void) => {
    let profile: unknown;
    try {
      profile = await swrFetcher(CLIENT_PROFILE_KEY);
    } catch (error) {
      console.error("[habits] profile re-read failed:", error);
    }
    if (profile === undefined) void mutate(CLIENT_PROFILE_KEY);
    else void mutate(CLIENT_PROFILE_KEY, profile, { revalidate: false });
    land();
  };

  /** Sends one write, in its habit's place in line, and lands what comes back. */
  const settle = async (
    day: string,
    habitId: string,
    week: Pick<HabitWeekSpan, "start" | "end">,
    change: ItemChange,
    send: () => Promise<HabitEntryResult | null>
  ) => {
    let result: HabitEntryResult | null;
    try {
      result = await send();
    } catch (error) {
      if (refusedOutright(error)) {
        // Nothing was saved: the habit goes back to what the server has. A
        // 403 means the day locked underneath the page: the day rule is read
        // again and lands with it.
        const takeBack = () => {
          ledger.drop(day, habitId, change);
          landHabit(habitId, week);
        };
        if (error.status === 403) await withDayRule(takeBack);
        else takeBack();
        throw error;
      }
      // The habit changed underneath the write, or no certain answer came
      // back: the day as the server has it decides what shows — and, without
      // an answer, whether the entry was saved after all.
      const saved = await reconcile(day, habitId, week, change);
      if (saved === true && !refusedByChange(error)) return;
      throw error;
    }
    if (result) {
      const answer = result;
      ledger.confirm(day, habitId, (item) => withAnswer(item, answer));
      ledger.confirmWeek(habitId, answer.week);
      ledger.drop(day, habitId, change);
      landHabit(habitId, week);
    } else {
      // Saved, but not read back: the change is what the server holds, and
      // the day read says the rest.
      ledger.confirmChange(day, habitId, change);
      ledger.drop(day, habitId, change);
      landHabit(habitId, week);
      await reconcile(day, habitId, week, null);
    }
  };

  /**
   * A change shown at once, on every day of its week, over the habit as the
   * day shows it now; the reads it moves cleared; its write put in line.
   */
  const write = (item: ClientHabitDayItem, change: ItemChange, send: () => Promise<HabitEntryResult | null>) => {
    const habitId = item.habit.id;
    const week = { start: item.week.start, end: item.week.end };
    ledger.open(heldItem(date, habitId) ?? item);
    ledger.add(date, habitId, change);
    landHabit(habitId, week);
    clearAround();
    return ledger.line(habitId, () => settle(date, habitId, week, change, send));
  };

  return {
    save: (item: ClientHabitDayItem, answer: HabitAnswer, note?: string | null) =>
      write(
        item,
        (found) =>
          withEntry(found, {
            done: "done" in answer ? answer.done : null,
            value: "value" in answer ? answer.value : null,
            note: note === undefined ? (found.day.entry?.note ?? null) : note,
          }),
        () => sendHabitEntry("PUT", item.habit.id, date, note === undefined ? answer : { ...answer, note })
      ),
    clear: (item: ClientHabitDayItem) =>
      write(item, (found) => withEntry(found, null), () => sendHabitEntry("DELETE", item.habit.id, date)),
  };
}

/**
 * The habits page's day and its entries. `day` is every habit a version
 * covers on the date, as the server has it with every change the client has
 * made and not yet had settled laid over it; `retry` reads the day again,
 * `retrying` while a read follows a failed one. `save` records a tick habit's
 * done or not, or a number habit's number, with the note when one is given
 * (null clears it; left out, the note stays); `clear` removes the entry, its
 * note with it.
 *
 * A change shows at once — on its day, and in its habit's week on every day
 * of that week — and stays until its own write settles. A habit's writes go
 * one after another, whatever day each is for, and no control waits for one:
 * a second gesture is put in line, never dropped. Making a change clears the
 * Journey, the habit week and every home day summary, whose next reads wait
 * for the entries on their way. When a write settles:
 * - saved: the habit lands as the answer has it — its day, its week and the
 *   words for both — on every day of its week a day read holds;
 * - refused (400, 403): the change goes, and the habit shows what the server
 *   has; on a 403 the client's day rule, read again, lands with it;
 * - the habit deleted or stopped underneath it (404, 409), saved but not read
 *   back, or no answer at all: the day is read straight from the server and
 *   the habit lands as it has it, or leaves the day, the change dropped in
 *   the same landing; with no answer, a read that shows the entry saved
 *   settles the write as saved.
 * Each write settles to undefined, or rejects with the server's
 * `HabitEntryError` or what `fetch` threw.
 */
export function useClientHabitDayEntries(date: string) {
  const { cache, mutate } = useSWRConfig();
  const clearHabitReads = useClearClientHabitReads();
  const clearDaySummaries = useClearClientDaySummaries();
  const ledger = habitEntryLedger(cache);
  const fetchDay = useCallback((url: string) => readDay(ledger, url), [ledger]);
  const { data, error, isValidating, mutate: revalidateDay } = useSWR<DayResponse>(clientHabitDayKey(date), fetchDay, {
    ...SWR_CONFIG,
    onError: (err) => console.error("[habits] day fetch failed:", err),
  });
  const retry = useCallback(() => void revalidateDay(), [revalidateDay]);
  const writes = useMemo(
    () => entryWrites({ cache, mutate, ledger, clearHabitReads, clearDaySummaries }, date),
    [cache, mutate, ledger, clearHabitReads, clearDaySummaries, date]
  );
  return { day: data?.data ?? null, error, retry, retrying: Boolean(error) && isValidating, ...writes };
}
