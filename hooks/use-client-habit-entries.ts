"use client";

import { useCallback } from "react";
import { useSWRConfig, type Cache } from "swr";
import { HabitEntryLedger } from "@/lib/habits/habit-entry-ledger";
import type { HabitEntryResult } from "@/types/habits";

// The client's habit entries, whichever screen makes them — the habits page
// and the check-in's Habits step (docs/HABITS-REBUILD-PLAN.md §2.4, §6): the
// one entry write, the line each habit's writes take, the reads that wait for
// the entries on their way, and the habit area's invalidator.

/** The client's habit routes: the entry route and every habit read. */
export const CLIENT_HABITS_AREA = "/api/client/habits";

/** Pure matcher for the client's habit area, exported so the area contract is testable without React. */
export function isClientHabitsAreaKey(key: unknown): boolean {
  return typeof key === "string" && key.startsWith(`${CLIENT_HABITS_AREA}/`);
}

// One ledger per SWR cache: the client's writes outlive the screen that made
// them, as the cache they land in does, so a client who leaves a screen and
// comes back while a write is on its way still has it in line and shown.
const ledgers = new WeakMap<Cache, HabitEntryLedger>();

/** The ledger of the client's habit entries on their way, one per SWR cache. */
export function habitEntryLedger(cache: Cache): HabitEntryLedger {
  const found = ledgers.get(cache);
  if (found) return found;
  const ledger = new HabitEntryLedger();
  ledgers.set(cache, ledger);
  return ledger;
}

/**
 * A fetcher for a read whose figures a habit entry moves — the home's day
 * summaries, the Journey, the check-in's context and its habit week: it waits
 * until every entry on its way has settled, so it never reads a figure from
 * before one. An entry clears those reads as it is made (CONVENTIONS §7: each
 * states a count), and their next read waits here.
 */
export function useReadAfterHabitEntries<T>(fetcher: (url: string) => Promise<T>): (url: string) => Promise<T> {
  const { cache } = useSWRConfig();
  const ledger = habitEntryLedger(cache);
  return useCallback(
    async (url: string) => {
      await ledger.settled();
      return fetcher(url);
    },
    [ledger, fetcher]
  );
}

/**
 * The client's habit area invalidator: every habit read but those `keep`
 * holds back — the habits page's days, the Journey, a check-in's week —
 * CLEARED, not merely revalidated (CONVENTIONS §7): each states a figure an
 * entry moves. A screen keeps the reads it has on screen: one cleared under it
 * would unmount its rows.
 */
export function useClearClientHabitReads() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (keep: (key: string) => boolean) =>
      mutate((key) => typeof key === "string" && isClientHabitsAreaKey(key) && !keep(key), undefined, { revalidate: true }),
    [mutate]
  );
}

/**
 * Runs one of a habit's entry writes in that habit's line: once every earlier
 * write of the habit has settled, from whichever screen made it, so its
 * answer's figures hold every one of them. The reads that wait for the
 * entries on their way (`useReadAfterHabitEntries`) wait for it too.
 */
export function useHabitEntryLine(): <T>(habitId: string, run: () => Promise<T>) => Promise<T> {
  const { cache } = useSWRConfig();
  const ledger = habitEntryLedger(cache);
  return useCallback(<T,>(habitId: string, run: () => Promise<T>) => ledger.line(habitId, run), [ledger]);
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

/** A refusal made before anything was saved, on a habit that still runs that day: the day stands as it was. */
export const refusedOutright = (error: unknown): error is HabitEntryError =>
  error instanceof HabitEntryError && (error.status === 400 || error.status === 403);

/** The coach deleted the habit (404) or stopped it (409) underneath the write: nothing was saved. */
export const refusedByChange = (error: unknown) => error instanceof HabitEntryError && (error.status === 404 || error.status === 409);

/**
 * The entry write. Answers with the habit's day and week as they now stand,
 * or null when the entry is saved but the server could not read them back.
 * A refusal throws a `HabitEntryError`; a request that never got an answer
 * throws what `fetch` threw. Every screen sends through it, each write in its
 * habit's line (`useHabitEntryLine`).
 */
export async function sendHabitEntry(
  method: "PUT" | "DELETE",
  habitId: string,
  date: string,
  body?: unknown
): Promise<HabitEntryResult | null> {
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
