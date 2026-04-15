"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { TrainingEvent } from "@/types/training";

type EventsResponse = {
  success: boolean;
  events: TrainingEvent[];
};

/**
 * Fetches and memoizes calendar events for a plan's full date range.
 * Returns events grouped by date for O(1) cell lookup.
 */
export function useCalendarEvents(
  clientId: string,
  planId: string | null,
  startDate: string | null,
  endDate: string | null
) {
  const key =
    clientId && planId && startDate && endDate
      ? `/api/clients/${clientId}/training/${planId}/events?startDate=${startDate}&endDate=${endDate}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<EventsResponse>(key, swrFetcher, {
    revalidateOnFocus: false,
  });

  const events = data?.events ?? [];

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
