"use client";

import { useCallback } from "react";
import { useSWRConfig } from "swr";

// Key construction and invalidation are deliberately co-located (the
// use-calendar-events.ts pattern): the two Overview readers build their keys
// here, and the matcher below widens to the API AREA those keys share, so a
// reader added later under the same area is covered without editing this.

/** The area every Overview read lives under. */
function clientOverviewAreaPrefix(clientId: string) {
  return `/api/clients/${clientId}/overview`;
}

/** `useOverviewBrief`'s key: Needs attention, the activity feed, the check-in
 *  cluster and the wellness flags. */
export function overviewBriefKey(clientId: string) {
  return `${clientOverviewAreaPrefix(clientId)}-brief`;
}

/** `useOverviewPlanSummary`'s key: the Current-plan cards. */
export function overviewPlanSummaryKey(clientId: string) {
  return `${clientOverviewAreaPrefix(clientId)}-plan-summary`;
}

/**
 * Drop every cached Overview read of a client, then let them refetch.
 *
 * CLEARED, not merely revalidated (CONVENTIONS §7). Both reads render a
 * DEFINITE answer — "No training plan on the calendar", a Needs-attention row
 * saying "No nutrition targets from 16 Feb" — and SWR serves the stale entry
 * for the whole refetch, so a coach returning to the Overview after placing a
 * program or saving targets read a claim that had just stopped being true.
 * Clearing puts each section into the pending state it already renders.
 *
 * Called from every calendar writer's success path — the placement, the
 * nutrition save and delete, the training delete, the plan editor's save, the block
 * screen's writes and the per-day calendar edits — and from the Journey's
 * measurement writers (Log measurement; Edit, Remove and Restore reading), whose
 * readings "Since your last visit" lists. None of them writes an Overview
 * table. The Overview is DERIVED from what they write, so the area that owes
 * the invalidator is the one that READS what you wrote (CONVENTIONS §7).
 * `hooks/use-client-overview.test.ts` scans for the callers.
 */
export function useClearClientOverview() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" && key.startsWith(clientOverviewAreaPrefix(clientId)),
        undefined,
        { revalidate: true }
      ),
    [mutate]
  );
}
