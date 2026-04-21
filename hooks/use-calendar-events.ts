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
 * Fetches and memoizes calendar events for a client across a date range.
 * Returns events grouped by date for O(1) cell lookup. Includes events from
 * all plans (active, planned, archived) so historical months render correctly.
 */
export function useCalendarEvents(
  clientId: string | null,
  startDate: string | null,
  endDate: string | null
) {
  const key =
    clientId && startDate && endDate
      ? `/api/clients/${clientId}/training/events?startDate=${startDate}&endDate=${endDate}`
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
