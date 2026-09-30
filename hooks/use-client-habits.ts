"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { useClearClientAdherence } from "@/hooks/use-client-adherence";
import { useClearActivationReadiness } from "@/hooks/use-activation-readiness";
import type { DayOfWeek } from "@/types/check-in";
import type {
  CoachHabitAddResult,
  CoachHabitList,
  CoachHabitWeek,
  CoachHabitWriteResult,
  HabitChoice,
  HabitDirection,
  HabitMeasure,
  HabitsAfterWrite,
} from "@/types/habits";

// The coach's habit reads and writes for one client (docs/HABITS-REBUILD-PLAN.md
// §2.4). Key construction lives here and nowhere else (CONVENTIONS §7): the
// Habits tab's list, its weeks and the Add habits sheet's choices read under
// these keys, and every habit write goes through `useHabitWrites`, whose
// answer — the client's habits and the week the tab shows, as they now stand,
// or neither when the write saved but they could not be read back — the caller
// lands in the same tick it closes what the write was made in, clearing every
// other read the write changed.

/** The area every habit read of a client lives under. */
function clientHabitsAreaPrefix(clientId: string): string {
  return `/api/clients/${clientId}/habits`;
}

/** The client's habits: running, upcoming and stopped, in their order. */
export function clientHabitsKey(clientId: string): string {
  return clientHabitsAreaPrefix(clientId);
}

/** The week tracker: the client week holding `start`, or the one holding the client's today. */
export function clientHabitWeekKey(clientId: string, start: string | null): string {
  return `${clientHabitsAreaPrefix(clientId)}/week${start ? `?start=${start}` : ""}`;
}

/** The Add habits sheet's list: the habits the coach has given any client, less this client's running or planned ones. */
export function clientHabitChoicesKey(clientId: string): string {
  return `${clientHabitsAreaPrefix(clientId)}/choices`;
}

/** Every habit read of the client but the list: the weeks, and anything added under the area later. */
export function isClientHabitReadBesideList(clientId: string) {
  const prefix = `${clientHabitsAreaPrefix(clientId)}/`;
  return (key: unknown): boolean => typeof key === "string" && key.startsWith(prefix);
}

/** The tracker's weeks for the client, whichever start each was read from. */
export function isClientHabitWeekKey(clientId: string) {
  const week = clientHabitWeekKey(clientId, null);
  return (key: unknown): boolean => typeof key === "string" && (key === week || key.startsWith(`${week}?`));
}

/**
 * Drop the client's cached habit weeks, then let them refetch — for a write
 * that moves the client's week without writing a habit: the next check-in
 * date, whose weekday the week starts on. CLEARED, not merely revalidated
 * (CONVENTIONS §7): a week renders definite figures, and an old week under
 * the new dates would be one of them.
 */
export function useClearClientHabitWeeks() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) => mutate(isClientHabitWeekKey(clientId), undefined, { revalidate: true }),
    [mutate]
  );
}

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  onError: (error: unknown) => console.error("Failed to load habits:", error),
} as const;

/** The client's habits as the coach manages them. */
export function useClientHabitList(clientId: string) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: CoachHabitList }>(
    clientId ? clientHabitsKey(clientId) : null,
    swrFetcher,
    SWR_CONFIG
  );
  const retry = useCallback(() => void mutate(), [mutate]);
  return { list: data?.data ?? null, error, isLoading, retry };
}

/**
 * One client week of the tracker: each habit's days as they happened, its
 * figures, the totals and today. The client writes the week's entries in
 * their own browser, which no invalidator here can reach, so the week is read
 * again when the coach comes back to the page (ARCHITECTURE → "SWR fetching").
 */
export function useClientHabitWeek(clientId: string, start: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: CoachHabitWeek }>(
    clientId ? clientHabitWeekKey(clientId, start) : null,
    swrFetcher,
    { ...SWR_CONFIG, revalidateOnFocus: true, dedupingInterval: 2000 }
  );
  const retry = useCallback(() => void mutate(), [mutate]);
  return { week: data?.data ?? null, error, isLoading, retry };
}

/**
 * The habits the coach can give this client again, read while the Add habits
 * sheet is open — the sheet is the only screen that shows them. The list the
 * sheet showed stays through its close (`keepPreviousData`), when the read
 * goes and a save has cleared its entry, so the closing sheet slides out as
 * it was rather than as loading bars (CONVENTIONS §7 → "No frame disagrees",
 * rule 5); the tab mounts the sheet afresh for each opening, so no opening
 * starts from another's list.
 */
export function useClientHabitChoices(clientId: string, open: boolean) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: HabitChoice[] }>(
    clientId && open ? clientHabitChoicesKey(clientId) : null,
    swrFetcher,
    { ...SWR_CONFIG, keepPreviousData: true }
  );
  const retry = useCallback(() => void mutate(), [mutate]);
  return { choices: data?.data ?? null, error, isLoading, retry };
}

/** When a habit runs: chosen weekdays (every day is all seven), or N times a week on any days. */
export type HabitSchedule = { weekdays: DayOfWeek[] } | { timesPerWeek: number };

/** A habit to add: what it is, its target and its days — chosen weekdays or N times a week. */
export type NewHabit = {
  name: string;
  howTo: string | null;
  measure: HabitMeasure;
  unit: string | null;
  direction: HabitDirection | null;
  target: number | null;
} & HabitSchedule;

/** A habit's target and days from a day — the client's today when `startsOn` is left out. */
type HabitChange = { startsOn?: string; target: number | null } & HabitSchedule;

/** One date of a set-days habit: planned or not, and a planned number habit's own target (null: the version's). */
type HabitDayChange = { planned: boolean; target: number | null };

/**
 * A write's answer as the tab lands it: the server's — the habits and the week
 * as they now stand, or neither — and the week the write named, whose read it
 * answers: its start, or null for the client's current week.
 */
type HabitWriteAnswer<T extends HabitsAfterWrite = HabitsAfterWrite> = T & { weekStart: string | null };

/** A write the server refused or could not make: its own sentence, to show as it is. */
export class HabitRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "HabitRequestError";
  }
}

/**
 * The coach's habit writes for one client, made from the Habits tab showing
 * the client week that starts `weekStart` (null: the client's current week).
 * Each write names that week, so its answer carries it: the client's habits
 * and that week as they now stand, or neither when the write saved but they
 * could not be read back. The caller lands the answer with `land` in the same
 * tick it closes what the write was made in (the goals sheet's shape,
 * `useGoalWrites`), so the card changes in place with no loading state
 * between (CONVENTIONS §7 → "Refreshing after a write"). An answer with
 * neither is still a saved write: its caller lands it and says so as it would
 * any other. A refusal throws `HabitRequestError` with the server's sentence.
 */
export function useHabitWrites(clientId: string, weekStart: string | null) {
  const { mutate } = useSWRConfig();
  const clearOverview = useClearClientOverview();
  const clearAdherence = useClearClientAdherence();
  const clearFeed = useClearAttentionFeed();
  const clearReadiness = useClearActivationReadiness();

  /**
   * Seeds the list, the week the write named and — when the write named
   * another week — the current week with its answer: cache writes in one
   * tick, so React renders them in the same frame. A write that changed
   * nothing stops there. Otherwise it clears every other habit read of the
   * client — the other weeks held, and anything added under the area later —
   * and the Add habits sheet's choices without reading them again: only the
   * sheet shows them, and it reads them afresh when it next opens, while the
   * closing sheet keeps the list it showed. With none of the three, the list
   * is refetched in place and every week cleared: the list is not cleared,
   * because the Add habits sheet and the row dialogs render only while it
   * exists and clearing it would cut a closing one — so on that rare path the
   * summary's Habits count shows the old number for one refetch. Either way a
   * change clears the Overview (its Needs attention rows), its adherence row,
   * the dashboard feed and the activation card — cleared rather than
   * revalidated, as each renders a definite answer.
   */
  const land = useCallback(
    (answer: HabitWriteAnswer & { changed?: boolean }) => {
      const beside = isClientHabitReadBesideList(clientId);
      const choices = clientHabitChoicesKey(clientId);
      if (answer.habits) {
        const shownWeek = clientHabitWeekKey(clientId, answer.weekStart);
        const seeded = new Set<unknown>([shownWeek]);
        void mutate(clientHabitsKey(clientId), { success: true, data: answer.habits }, { revalidate: false });
        void mutate(shownWeek, { success: true, data: answer.week }, { revalidate: false });
        if (answer.currentWeek) {
          const currentWeek = clientHabitWeekKey(clientId, null);
          seeded.add(currentWeek);
          void mutate(currentWeek, { success: true, data: answer.currentWeek }, { revalidate: false });
        }
        if (answer.changed === false) return;
        void mutate((key: unknown) => beside(key) && !seeded.has(key) && key !== choices, undefined, { revalidate: true });
      } else {
        void mutate(clientHabitsKey(clientId));
        void mutate((key: unknown) => beside(key) && key !== choices, undefined, { revalidate: true });
      }
      void mutate(choices, undefined, { revalidate: false });
      void clearAdherence(clientId);
      void clearOverview(clientId);
      void clearFeed();
      void clearReadiness(clientId);
    },
    [mutate, clientId, clearAdherence, clearOverview, clearFeed, clearReadiness]
  );

  return useMemo(() => {
    const habitPath = (habitId: string) => `${clientHabitsKey(clientId)}/${habitId}`;
    const write = <T extends HabitsAfterWrite>(method: string, path: string, body?: unknown) =>
      send<T>(method, path, weekStart, body);
    return {
      land,
      add: (habits: NewHabit[], startsOn?: string) =>
        write<CoachHabitAddResult>("POST", clientHabitsKey(clientId), { habits, ...(startsOn ? { startsOn } : {}) }),
      rename: (habitId: string, name: string, howTo: string | null) =>
        write<CoachHabitWriteResult>("PATCH", habitPath(habitId), { name, howTo }),
      change: (habitId: string, change: HabitChange) =>
        write<CoachHabitWriteResult>("POST", `${habitPath(habitId)}/change`, change),
      stop: (habitId: string, stopsOn?: string) =>
        write<CoachHabitWriteResult>("POST", `${habitPath(habitId)}/stop`, stopsOn ? { stopsOn } : {}),
      remove: (habitId: string) => write<CoachHabitWriteResult>("DELETE", habitPath(habitId)),
      order: (habitIds: string[]) => write<CoachHabitWriteResult>("PUT", `${clientHabitsKey(clientId)}/order`, { habitIds }),
      setDay: (habitId: string, date: string, day: HabitDayChange) =>
        write<CoachHabitWriteResult>("PUT", `${habitPath(habitId)}/days/${date}`, {
          planned: day.planned,
          ...(day.target !== null ? { target: day.target } : {}),
        }),
      resetDay: (habitId: string, date: string) =>
        write<CoachHabitWriteResult>("DELETE", `${habitPath(habitId)}/days/${date}`),
    };
  }, [clientId, weekStart, land]);
}

/**
 * One habit write, naming the week the tab shows: its answer stamped with that
 * week, or the server's sentence thrown as a `HabitRequestError`.
 */
async function send<T extends HabitsAfterWrite>(
  method: string,
  path: string,
  weekStart: string | null,
  body?: unknown
): Promise<HabitWriteAnswer<T>> {
  const response = await fetch(weekStart ? `${path}?week=${weekStart}` : path, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await response.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!response.ok || !json?.success || !json.data) {
    throw new HabitRequestError(json?.error ?? "Something went wrong. Try again.", response.status);
  }
  return { ...json.data, weekStart };
}

/** The coach's habit writes, as `useHabitWrites` returns them. */
export type HabitWrites = ReturnType<typeof useHabitWrites>;
