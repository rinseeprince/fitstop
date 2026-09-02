"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientLayoutMove, ClientTrainingWeek } from "@/types/client-training-week";

// The client portal's training-area SWR keys, and the ONE invalidator that
// matches them (CONVENTIONS §7: every read behind a hook that exports its key
// builder and an invalidator matching the API AREA, never one endpoint). A
// layout write rewrites the day summaries of every day it touched and the
// week's session list, so it invalidates the whole area rather than guessing
// which dates a swap changed.

const CLIENT_TRAINING_AREA_PREFIXES = [
  "/api/client/day-summary",
  "/api/client/training/week",
] as const;

export const clientDaySummaryKey = (date: string) => `/api/client/day-summary?date=${date}`;
export const clientTrainingWeekKey = (date: string) => `/api/client/training/week?date=${date}`;

/** Pure matcher, exported so the area contract is testable without React. */
export function isClientTrainingAreaKey(key: unknown): boolean {
  return (
    typeof key === "string" &&
    CLIENT_TRAINING_AREA_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function useInvalidateClientTrainingData() {
  const { mutate } = useSWRConfig();
  // Memoized: a hook returning a callback must return a stable one.
  return useCallback(() => mutate(isClientTrainingAreaKey), [mutate]);
}

/**
 * A refused layout: the server's own sentence, plus the HTTP status so a caller
 * can tell "your week changed / that day is taken" (409 — reload the week)
 * from a rule of the client's own calendar (400 — show it and carry on).
 */
export class ClientLayoutError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ClientLayoutError";
    this.status = status;
  }
}

/**
 * The ONE client-side writer for "a session changes date": POSTs a layout
 * (a single move, a two-day swap, a week rearrangement) and invalidates the
 * training area on success. Throws with the server's own sentence on a
 * refusal — "Sat, Aug 29 already has a session", "Your week changed since
 * you opened it — reload and try again" — so the caller can show it as is.
 */
export function useApplyClientLayout() {
  const invalidate = useInvalidateClientTrainingData();
  return useCallback(
    async (moves: ClientLayoutMove[]): Promise<{ moved: ClientLayoutMove[] }> => {
      const res = await fetch("/api/client/training/events/layout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moves }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success: boolean; data?: { moved: ClientLayoutMove[] }; error?: string }
        | null;
      if (!res.ok || !json?.success || !json.data) {
        throw new ClientLayoutError(json?.error ?? "Failed to move sessions", res.status);
      }
      await invalidate();
      return json.data;
    },
    [invalidate],
  );
}

type WeekResponse = { success: boolean; data: ClientTrainingWeek };

/** The training week containing `date` — the picker's and the week view's read. */
export function useClientTrainingWeek(date: string | null) {
  return useSWR<WeekResponse>(date ? clientTrainingWeekKey(date) : null, swrFetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    dedupingInterval: 2000,
  });
}
