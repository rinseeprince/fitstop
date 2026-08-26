"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { TrainingEvent } from "@/types/training";

type EventsResponse = {
  success: boolean;
  events: TrainingEvent[];
};

// Key construction and invalidation are deliberately co-located so they can
// never drift (mirrors use-nutrition-calendar-events.ts): never build a
// /training/events key anywhere else.
//
// The two are deliberately DIFFERENT widths. Building a key is specific to one
// endpoint; invalidating is not. See the matcher below.
function trainingEventsKeyPrefix(clientId: string) {
  return `/api/clients/${clientId}/training/events?`;
}

/**
 * Everything a client's training data is read from — the month calendar, the
 * plan editor's amendment GET, the placed-session tray, and any reader added
 * later.
 *
 * This matcher is an API AREA, not an endpoint. It used to be the key prefix
 * above, and that trailing `events?` is exactly why saving a session's
 * exercises from the calendar left the plan editor showing pre-edit data: the
 * write refreshed the calendar and could not reach the editor's cache, so the
 * editor needed a hard refresh. A narrow prefix silently excludes every reader
 * added after it.
 */
function trainingAreaKeyPrefix(clientId: string) {
  return `/api/clients/${clientId}/training`;
}

/**
 * Invalidates every cached read of a client's training data. The ONE sanctioned
 * way to refresh it from outside the hook that read it — for success handlers
 * that rewrite training rows without holding that reader's bound `mutate`.
 *
 * Plain no-data mutate: mounted windows revalidate in place (no loading
 * flash); unmounted cached windows refetch on next mount via revalidateIfStale.
 */
export function useInvalidateTrainingData() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith(trainingAreaKeyPrefix(clientId))
      ),
    [mutate]
  );
}

/**
 * Fetches and memoizes calendar events for a client across a date range.
 * Returns events grouped by date for O(1) cell lookup. Includes events from
 * all coexisting provenance plans (current, upcoming, ended and archived) so
 * historical months render correctly.
 */
export function useCalendarEvents(
  clientId: string | null,
  startDate: string | null,
  endDate: string | null
) {
  const key =
    clientId && startDate && endDate
      ? `${trainingEventsKeyPrefix(clientId)}startDate=${startDate}&endDate=${endDate}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<EventsResponse>(key, swrFetcher, {
    revalidateOnFocus: false,
  });

  const events = useMemo(() => data?.events ?? [], [data]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, TrainingEvent[]>();
    for (const event of events) {
      const existing = map.get(event.date);
      if (existing) {
        existing.push(event);
      } else {
        map.set(event.date, [event]);
      }
    }
    return map;
  }, [events]);

  return { events, eventsByDate, isLoading, error, mutate };
}
