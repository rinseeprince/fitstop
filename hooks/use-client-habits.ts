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
  HabitDirection,
  HabitMeasure,
} from "@/types/habits";

// The coach's habit reads and writes for one client (docs/HABITS-REBUILD-PLAN.md
// §2.4). Key construction lives here and nowhere else (CONVENTIONS §7): the
// Habits tab's list and week read under these keys, and every habit write goes
// through `useHabitWrites`, whose answer — the client's habits as they now
// stand, or null when the write saved but they could not be read back — the
// caller lands in the list in the same tick it closes what the write was made
// in, clearing every other read the write changed.

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

/** One client week of the tracker: each habit's days as they happened, its figures, the totals and today. */
export function useClientHabitWeek(clientId: string, start: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: CoachHabitWeek }>(
    clientId ? clientHabitWeekKey(clientId, start) : null,
    swrFetcher,
    { ...SWR_CONFIG, dedupingInterval: 2000 }
  );
  const retry = useCallback(() => void mutate(), [mutate]);
  return { week: data?.data ?? null, error, isLoading, retry };
}

/** A habit to add: what it is, its target and its days — chosen weekdays or N times a week. */
export type NewHabit = {
  name: string;
  howTo: string | null;
  measure: HabitMeasure;
  unit: string | null;
  direction: HabitDirection | null;
  target: number | null;
} & ({ weekdays: DayOfWeek[] } | { timesPerWeek: number });

/** A habit's target and days from a day — the client's today when `startsOn` is left out. */
type HabitChange = { startsOn?: string; target: number | null } & (
  | { weekdays: DayOfWeek[] }
  | { timesPerWeek: number }
);

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
 * The coach's habit writes for one client. Each resolves with its answer — the
 * client's habits as they now stand, or null when the write saved but they
 * could not be read back — which the caller lands with `land` in the same tick
 * it closes what the write was made in (the goals sheet's shape,
 * `useGoalWrites`). A null answer is still a saved write: its caller lands it
 * and says so as it would any other. Landing seeds the list read with the
 * answer; with none, it refetches the list in place — never cleared, since a
 * list's stale value is merely old (CONVENTIONS §7) and the drawer renders
 * only while the list exists. Either way it clears every other read the write
 * changed: the tracker's weeks, the Overview (its Needs attention rows), its
 * adherence row, the dashboard feed and the activation card — cleared rather
 * than revalidated, as each renders a definite answer. A refusal throws
 * `HabitRequestError` with the server's sentence.
 */
export function useHabitWrites(clientId: string) {
  const { mutate } = useSWRConfig();
  const clearOverview = useClearClientOverview();
  const clearAdherence = useClearClientAdherence();
  const clearFeed = useClearAttentionFeed();
  const clearReadiness = useClearActivationReadiness();

  const land = useCallback(
    (habits: CoachHabitList | null) => {
      if (habits) void mutate(clientHabitsKey(clientId), { success: true, data: habits }, { revalidate: false });
      else void mutate(clientHabitsKey(clientId));
      void mutate(isClientHabitReadBesideList(clientId), undefined, { revalidate: true });
      void clearAdherence(clientId);
      void clearOverview(clientId);
      void clearFeed();
      void clearReadiness(clientId);
    },
    [mutate, clientId, clearAdherence, clearOverview, clearFeed, clearReadiness]
  );

  return useMemo(() => {
    const habitPath = (habitId: string) => `${clientHabitsKey(clientId)}/${habitId}`;
    return {
      land,
      add: (habits: NewHabit[], startsOn?: string) =>
        send<CoachHabitAddResult>("POST", clientHabitsKey(clientId), { habits, ...(startsOn ? { startsOn } : {}) }),
      rename: (habitId: string, name: string, howTo: string | null) =>
        send<CoachHabitWriteResult>("PATCH", habitPath(habitId), { name, howTo }),
      change: (habitId: string, change: HabitChange) =>
        send<CoachHabitWriteResult>("POST", `${habitPath(habitId)}/change`, change),
      stop: (habitId: string) => send<CoachHabitWriteResult>("POST", `${habitPath(habitId)}/stop`, {}),
      remove: (habitId: string) => send<CoachHabitWriteResult>("DELETE", habitPath(habitId)),
      order: (habitIds: string[]) => send<CoachHabitWriteResult>("PUT", `${clientHabitsKey(clientId)}/order`, { habitIds }),
    };
  }, [clientId, land]);
}

/** One habit write: its answer, or the server's sentence thrown as a `HabitRequestError`. */
async function send<T extends { habits: CoachHabitList | null }>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await response.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!response.ok || !json?.success || !json.data) {
    throw new HabitRequestError(json?.error ?? "Something went wrong. Try again.", response.status);
  }
  return json.data;
}

/** The coach's habit writes, as `useHabitWrites` returns them. */
export type HabitWrites = ReturnType<typeof useHabitWrites>;
