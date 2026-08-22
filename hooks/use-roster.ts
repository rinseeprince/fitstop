"use client"

import { useCallback, useMemo } from "react"
import useSWR from "swr"
import { swrFetcher } from "@/lib/swr-fetcher"
import { useOverdueClients } from "@/hooks/use-check-in-data"
import type { ClientWithCheckInInfo } from "@/types/check-in"
import {
  getRosterStatus,
  matchesRosterView,
  ROSTER_VIEWS,
  type RosterCounts,
  type RosterRow,
} from "@/lib/roster-views"

/**
 * The Clients roster, as one shape.
 *
 * Two fetches, both of which the page already made: the roster itself
 * (deactivated clients included, so the Inactive view and reactivation work)
 * and the overdue set, whose `daysOverdue` is threaded onto the matching row
 * rather than recomputed. The old Pending Onboarding banner's third fetch is
 * gone: "ready for review" is just `onboarding_status = intake_completed`, and
 * its "Invited {date}" is the client row's own `createdAt` — minted in the
 * same request as the intake it was reading.
 *
 * Both fetches are represented in what the hook returns. Reporting only the
 * roster's `isLoading` made a cold load of `?view=overdue` render "0" and an
 * empty-state as though they were settled, and returning only the roster's
 * `mutate` left a reactivated client missing from the Overdue view until the
 * next 60s poll.
 */
export function useRoster() {
  const { data, error, isLoading, mutate } = useSWR<{
    clients: ClientWithCheckInInfo[]
  }>("/api/clients?includeInactive=true", swrFetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
  })

  const {
    clients: overdueClients,
    isLoading: overdueLoading,
    mutate: mutateOverdue,
  } = useOverdueClients()

  const rows = useMemo<RosterRow[]>(() => {
    const daysOverdueById = new Map(
      overdueClients.map((client) => [client.id, client.daysOverdue]),
    )
    return (data?.clients ?? []).map((client) => ({
      client,
      status: getRosterStatus(client),
      daysOverdue: daysOverdueById.get(client.id) ?? 0,
    }))
  }, [data?.clients, overdueClients])

  const counts = useMemo<RosterCounts>(() => {
    const result = {} as RosterCounts
    for (const view of ROSTER_VIEWS) {
      result[view.value] = rows.filter((row) =>
        matchesRosterView(row, view.value),
      ).length
    }
    return result
  }, [rows])

  // Refreshes BOTH keys, and swallows its own rejection so callers can fire it
  // without leaving an unhandled promise behind. A failed revalidation is not
  // a failed action — the caller has already reported the action's outcome.
  const refresh = useCallback(async () => {
    await Promise.all([mutate(), mutateOverdue()]).catch(() => {})
  }, [mutate, mutateOverdue])

  return {
    rows,
    counts,
    isLoading: isLoading || overdueLoading,
    isError: Boolean(error),
    refresh,
  }
}
