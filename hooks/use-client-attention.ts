"use client"

import {
  useOverdueClients,
  useUnreviewedCheckIns,
} from "@/hooks/use-check-in-data"
import { indexUnreviewedCheckIns } from "@/lib/roster-views"

/**
 * What the Clients nav badge counts: the roster sidebar's two "Attention"
 * queues added together — overdue check-ins, plus clients with a check-in
 * waiting to be reviewed.
 *
 * **It is the two views, not two numbers that resemble them.** The overdue half
 * is `/api/clients/overdue`, the very set the roster threads onto its rows; the
 * review half runs the roster's own `indexUnreviewedCheckIns` over the queue the
 * roster reads. A badge that spells either predicate itself is how this number
 * came to disagree with the page it sits beside, twice:
 *   - it once counted unreviewed check-ins from `/api/check-ins/recent`,
 *     fetched by a hand-rolled setInterval in each nav component;
 *   - it then counted submitted INTAKES, which stopped being an attention queue
 *     when "Ready for review" was redefined as check-ins (2026-08-29).
 * The intake queue is still reachable — the roster's Onboarding view, the
 * dashboard's PendingIntakeBanner, the floating intake panel — it is simply not
 * one of the two queues this badge is about, so the `/api/coach/pending-intakes`
 * poll left with the redefinition.
 *
 * CLIENTS, never check-ins: two check-ins from one client are one thing to do,
 * and `useUnreviewedCheckIns().total` counts rows. Both halves are active-only
 * at their endpoints (`getOverdueClients` filters `client.active`; the queue
 * route filters the coach's client ids the same way), so a deactivated client
 * cannot inflate a badge that leads to a page they no longer have.
 *
 * Costs nothing extra: both sets are already fetched on every coach page by
 * NotificationsDropdown, so SWR serves them from cache.
 *
 * TRAINER-ONLY. Both call sites mount below PersistentSidebar's role gate, and
 * both endpoints are coach-scoped. There is deliberately no `enabled` flag: both
 * halves ride app-wide fetches that cannot be gated from here, so a parameter
 * would have advertised a guard it did not honour.
 */
export function useClientAttentionCount(): number {
  const { total: overdueTotal } = useOverdueClients()
  const { checkIns } = useUnreviewedCheckIns()

  return overdueTotal + indexUnreviewedCheckIns(checkIns).size
}
