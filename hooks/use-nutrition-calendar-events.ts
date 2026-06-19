"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { NutritionEvent } from "@/types/check-in";

type EventsResponse = {
  success: boolean;
  events: NutritionEvent[];
};

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
      ? `/api/clients/${clientId}/nutrition/events?startDate=${startDate}&endDate=${endDate}`
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
