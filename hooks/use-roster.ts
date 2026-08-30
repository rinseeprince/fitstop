"use client"

import { useCallback, useMemo } from "react"
import useSWR from "swr"
import { swrFetcher } from "@/lib/swr-fetcher"
import {
  useOverdueClients,
  useUnreviewedCheckIns,
} from "@/hooks/use-check-in-data"
import type { ClientWithCheckInInfo } from "@/types/check-in"
import {
  getRosterStatus,
  indexUnreviewedCheckIns,
  matchesRosterView,
  ROSTER_VIEWS,
  type RosterCounts,
  type RosterRow,
} from "@/lib/roster-views"

/**
 * The Clients roster, as one shape.
 *
 * Three fetches, every one of which the page already made: the roster itself
 * (deactivated clients included, so the Inactive view and reactivation work),
 * the overdue set — whose `daysOverdue` is threaded onto the matching row
 * rather than recomputed — and the coach-wide unreviewed check-in queue, which
 * `NotificationsDropdown` mounts inside `RosterShell`, so SWR serves it from
 * cache and the third read costs no request.
 *
 * The queue is what the review view has meant since 2026-08-29: a client with an
 * unreviewed CHECK-IN, not a submitted intake. The intake queue is still the
 * Onboarding view's own rows. (The view is labelled "Unreviewed check-ins"
 * since 2026-08-30; `counts.review` is still a count of CLIENTS, because it
 * sits beside a list with one row per client.)
 *
 * All three are represented in what the hook returns. Reporting only the
 * roster's `isLoading` made a cold load of `?view=overdue` render "0" and an
 * empty-state as though they were settled; returning only the roster's `mutate`
 * left a reactivated client missing from the Overdue view until the next 60s
 * poll; and a failed queue fetch alone would leave every row's
 * `unreviewedCheckIn` null, so `?view=review` would render "No check-ins
 * waiting" as a settled all-clear.
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
    isError: overdueError,
    mutate: mutateOverdue,
  } = useOverdueClients()

  const {
    checkIns: unreviewedCheckIns,
    isLoading: unreviewedLoading,
    isError: unreviewedError,
    mutate: mutateUnreviewed,
  } = useUnreviewedCheckIns()

  const rows = useMemo<RosterRow[]>(() => {
    const daysOverdueById = new Map(
      overdueClients.map((client) => [client.id, client.daysOverdue]),
    )
    // One check-in per client, the newest — the same fact the client's own
    // Overview shows in its awaiting-review row.
    const unreviewedByClientId = indexUnreviewedCheckIns(unreviewedCheckIns)
    return (data?.clients ?? []).map((client) => ({
      client,
      status: getRosterStatus(client),
      daysOverdue: daysOverdueById.get(client.id) ?? 0,
      unreviewedCheckIn: unreviewedByClientId.get(client.id) ?? null,
    }))
  }, [data?.clients, overdueClients, unreviewedCheckIns])

  const counts = useMemo<RosterCounts>(() => {
    const result = {} as RosterCounts
    for (const view of ROSTER_VIEWS) {
      result[view.value] = rows.filter((row) =>
        matchesRosterView(row, view.value),
      ).length
    }
    return result
  }, [rows])

  // Refreshes ALL THREE keys, and swallows its own rejection so callers can
  // fire it without leaving an unhandled promise behind. A failed revalidation
  // is not a failed action — the caller has already reported the action's
  // outcome. The queue is in here because deactivating a client has to empty
  // their row out of Unreviewed check-ins as well as out of Active.
  const refresh = useCallback(async () => {
    await Promise.all([mutate(), mutateOverdue(), mutateUnreviewed()]).catch(
      () => {},
    )
  }, [mutate, mutateOverdue, mutateUnreviewed])

  return {
    rows,
    counts,
    isLoading: isLoading || overdueLoading || unreviewedLoading,
    // ALL THREE fetches, for the same reason isLoading folds them in: a queue
    // that failed alone renders each attention view's empty state as a settled
    // all-clear rather than as a fetch that never landed.
    isError: Boolean(error) || Boolean(overdueError) || Boolean(unreviewedError),
    refresh,
  }
}
