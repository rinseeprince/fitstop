"use client"

import useSWR from "swr"
import { swrFetcher } from "@/lib/swr-fetcher"
import { useOverdueClients } from "@/hooks/use-check-in-data"
import type { PendingIntakeSummary } from "@/types/client-intake"

/**
 * What the Clients nav badge counts: overdue check-ins plus clients whose
 * intake is waiting to be reviewed — the two queues the roster sidebar shows
 * under "Attention".
 *
 * It used to count unreviewed check-ins (`/api/check-ins/recent` filtered to
 * `ai_processed`), fetched by a hand-rolled setInterval in each nav component.
 * That is a check-ins number wearing a roster badge: it agreed with nothing on
 * the page it sat next to. Unreviewed check-ins are still carried by the
 * notification bell, which counts them alongside overdue and due-soon.
 *
 * Costs nothing extra: the overdue set is already fetched on every coach page
 * by NotificationsDropdown, so SWR serves it from cache, and the pending-intake
 * poll replaces the one this hook retires.
 *
 * TRAINER-ONLY. Both call sites mount below PersistentSidebar's role gate, and
 * both endpoints are coach-scoped. There is deliberately no `enabled` flag: the
 * overdue half rides an app-wide fetch that cannot be gated from here, so a
 * parameter would have advertised a guard it only half-honoured.
 */
export function useClientAttentionCount(): number {
  const { total: overdueTotal } = useOverdueClients()

  const { data } = useSWR<{ success: boolean; data: PendingIntakeSummary[] }>(
    "/api/coach/pending-intakes",
    swrFetcher,
    {
      refreshInterval: 60000,
      // Deliberately true, against the §7 default — the same reasoning as
      // useOverdueClients: the dominant writer of both numbers is someone
      // else's session (a client submitting an intake, a check-in falling
      // due), which no coach-side invalidator can reach. SWR suspends polling
      // while the tab is hidden, so focus revalidation is the only prompt
      // refresh after an alt-tab.
      revalidateOnFocus: true,
      dedupingInterval: 5000,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      onError: (err) =>
        console.error("Failed to fetch pending intakes for nav badge:", err),
    },
  )

  const readyForReview = (data?.data ?? []).filter(
    (intake) => intake.status === "completed",
  ).length

  return overdueTotal + readyForReview
}
