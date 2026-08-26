"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { NutritionEvent } from "@/types/check-in";

type EventsResponse = {
  success: boolean;
  events: NutritionEvent[];
};

// Key construction and invalidation are deliberately co-located so they can
// never drift: never build a /nutrition/events key anywhere else.
function nutritionEventsKeyPrefix(clientId: string) {
  return `/api/clients/${clientId}/nutrition/events?`;
}

function buildNutritionEventsKey(
  clientId: string,
  startDate: string,
  endDate: string
) {
  return `${nutritionEventsKeyPrefix(clientId)}startDate=${startDate}&endDate=${endDate}`;
}

/**
 * Invalidates every cached month window of a client's nutrition calendar.
 * MUST be called from any success handler whose server route rewrites
 * nutrition_events (plan regenerate, training cascades) —
 * the calendar has no other way to learn its cache is stale.
 *
 * Plain no-data mutate: mounted windows revalidate in place (no loading
 * flash); unmounted cached windows refetch on next mount via revalidateIfStale.
 */
export function useInvalidateNutritionCalendar() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith(nutritionEventsKeyPrefix(clientId))
      ),
    [mutate]
  );
}

/**
 * Fetches and memoizes a client's nutrition_events for a date range (coach
 * calendar). Nutrition is one-event-per-date (UNIQUE(client_id,date)), so events
 * are keyed by date string for O(1) cell lookup — a flat Map, not an array map.
 */
export function useNutritionCalendarEvents(
  clientId: string | null,
  startDate: string | null,
  endDate: string | null
) {
  const key =
    clientId && startDate && endDate
      ? buildNutritionEventsKey(clientId, startDate, endDate)
      : null;

  const { data, error, isLoading, mutate } = useSWR<EventsResponse>(key, swrFetcher, {
    revalidateOnFocus: false,
  });

  const events = useMemo(() => data?.events ?? [], [data]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, NutritionEvent>();
    for (const event of events) {
      map.set(event.date.split("T")[0], event);
    }
    return map;
  }, [events]);

  return { events, eventsByDate, isLoading, error, mutate };
}
