"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { clientDaySummaryKey } from "@/hooks/use-client-training-data";
import { entryMet } from "@/lib/habits/habit-entry";
import { weekFigureWords } from "@/lib/habits/habit-words";
import type {
  ClientHabitDay,
  ClientHabitDayItem,
  ClientHabitProgress,
  HabitAnswer,
  HabitEntryResult,
} from "@/types/habits";

// The client's habit reads and the entry write (docs/HABITS-REBUILD-PLAN.md
// §2.4). Key construction lives here and nowhere else (CONVENTIONS §7): the
// habits page reads its day under one key, the Journey its weeks under
// another, and the entry write lands its answer — the habit's day and week as
// they now stand — on that habit in the day read, refreshing the rest of the
// area and the home day summary.

const CLIENT_HABITS_AREA = "/api/client/habits";

/** Every habit a version covers on `date`, with the day, the week holding it and the words. */
export function clientHabitDayKey(date: string): string {
  return `${CLIENT_HABITS_AREA}/day?date=${date}`;
}

/** The Journey's habits: the last `weeks` client weeks and the last days as they happened. */
export function clientHabitProgressKey(weeks: number): string {
  return `${CLIENT_HABITS_AREA}/progress?weeks=${weeks}`;
}

/** Pure matcher for the client's habit area, exported so the area contract is testable without React. */
export function isClientHabitsAreaKey(key: unknown): boolean {
  return typeof key === "string" && key.startsWith(`${CLIENT_HABITS_AREA}/`);
}

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 2000,
} as const;

type DayResponse = { success: boolean; data: ClientHabitDay };

/** The client's habits on `date`: every habit a version covers that day, planned or not. */
export function useClientHabitDay(date: string) {
  const { data, error, isLoading, mutate } = useSWR<DayResponse>(clientHabitDayKey(date), swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("[habits] day fetch failed:", err),
  });
  const retry = useCallback(() => void mutate(), [mutate]);
  return { day: data?.data ?? null, error, isLoading, retry };
}

/** The Journey's habits over the last `weeks` client weeks. */
export function useClientHabitProgress(weeks: number) {
  const { data, error, isLoading } = useSWR<{ success: boolean; data: ClientHabitProgress }>(
    clientHabitProgressKey(weeks),
    swrFetcher,
    { ...SWR_CONFIG, onError: (err) => console.error("[habits] progress fetch failed:", err) }
  );
  return { progress: data?.data ?? null, error, isLoading };
}

/** A write the server refused or could not make: its own sentence, and its status (403: the day locked). */
export class HabitEntryError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "HabitEntryError";
  }
}

/** One habit's item with its day and week as the entry write answered them. */
function withResult(item: ClientHabitDayItem, result: HabitEntryResult): ClientHabitDayItem {
  return { ...item, day: result.day, week: result.week, words: { ...item.words, week: weekFigureWords(result.week) } };
}

/** The day read with one habit's item replaced; every other habit's as it is. */
function applyToDay(current: DayResponse | undefined, habitId: string, apply: (item: ClientHabitDayItem) => ClientHabitDayItem) {
  if (!current) return current;
  return {
    ...current,
    data: {
      ...current.data,
      habits: current.data.habits.map((item) => (item.habit.id === habitId ? apply(item) : item)),
    },
  };
}

/**
 * The entry write. Answers with the habit's day and week as they now stand,
 * or null when the entry is saved but the server could not read them back.
 * A refusal throws a `HabitEntryError`; a request that never got an answer
 * throws what `fetch` threw.
 */
async function sendEntry(method: "PUT" | "DELETE", habitId: string, date: string, body?: unknown): Promise<HabitEntryResult | null> {
  const response = await fetch(`${CLIENT_HABITS_AREA}/${habitId}/days/${date}`, {
    method,
    credentials: "include",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: HabitEntryResult | null; error?: string }
    | null;
  if (!response.ok || !json?.success) {
    throw new HabitEntryError(json?.error ?? "Please try again.", response.status);
  }
  return json.data ?? null;
}

/**
 * The client's entry for a habit on a day: `save` records a tick habit's done
 * or not, or a number habit's number; `clear` removes the entry. Each write
 * changes its own habit's item in the day read and no other, each time built
 * on the day as it is displayed: the change shows at once; the answer lands on
 * that habit alone; a refusal puts that habit back as it was when the write
 * began and throws. So writes on two habits in flight together each keep
 * their own change and answer, in whichever order the answers come. (SWR's
 * async mutate cannot: it builds on the day as it stood before the first
 * write in flight, and drops an earlier write's answer when a later write
 * started.) A write saved but not read back keeps the change and reads the
 * day again. After a success the rest of the habit area (the Journey) and the
 * home day summary, whose habits card counts the day, are refreshed. A
 * refusal throws a `HabitEntryError` with the server's sentence.
 */
export function useHabitEntryWrites(date: string) {
  const { mutate } = useSWRConfig();

  return useMemo(() => {
    const dayKey = clientHabitDayKey(date);

    /** One habit's item in the day read as displayed now, replaced at once; no read follows. */
    const setItem = (habitId: string, apply: (item: ClientHabitDayItem) => ClientHabitDayItem) =>
      void mutate<DayResponse>(dayKey, (current) => applyToDay(current, habitId, apply), { revalidate: false });

    const write = async (
      item: ClientHabitDayItem,
      shown: (found: ClientHabitDayItem) => ClientHabitDayItem,
      send: () => Promise<HabitEntryResult | null>
    ) => {
      const habitId = item.habit.id;
      setItem(habitId, shown);
      let result: HabitEntryResult | null;
      try {
        result = await send();
      } catch (error) {
        setItem(habitId, () => item);
        throw error;
      }
      if (result) {
        const answered = result;
        setItem(habitId, (found) => withResult(found, answered));
      } else {
        // Saved, but the server could not read the day back: the change stays
        // on screen and the day is read again.
        void mutate(dayKey);
      }
      void mutate((key) => isClientHabitsAreaKey(key) && key !== dayKey);
      void mutate(clientDaySummaryKey(date));
    };

    return {
      save: (item: ClientHabitDayItem, answer: HabitAnswer) =>
        write(
          item,
          // A tick shows at once: the entry as sent, judged by the kernel.
          (found) => {
            const entry = {
              done: "done" in answer ? answer.done : null,
              value: "value" in answer ? answer.value : null,
              note: found.day.entry?.note ?? null,
            };
            return { ...found, day: { ...found.day, entry, met: entryMet(found.habit, entry, found.day.target) } };
          },
          () => sendEntry("PUT", item.habit.id, date, answer)
        ),
      clear: (item: ClientHabitDayItem) =>
        write(
          item,
          // The entry goes at once, as a save's shows at once: no frame keeps
          // the day's "Done" beside the box the client just emptied.
          (found) => ({ ...found, day: { ...found.day, entry: null, met: false } }),
          () => sendEntry("DELETE", item.habit.id, date)
        ),
    };
  }, [mutate, date]);
}
