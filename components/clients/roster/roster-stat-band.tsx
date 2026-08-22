"use client"

import { useRouter } from "next/navigation"
import { StatBand, type StatBandCell } from "@/components/programs/shared/stat-band"
import {
  isOnboarding,
  isWeeklyCheckInClient,
  rosterViewUrl,
  type RosterCounts,
  type RosterRow,
} from "@/lib/roster-views"
import { CRITICALLY_OVERDUE_DAYS } from "@/lib/constants"

/** A check-in counts towards "this week" if it landed in the last seven days. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function RosterStatBand({
  rows,
  counts,
}: {
  rows: RosterRow[]
  counts: RosterCounts
}) {
  const router = useRouter()

  const onboardingCount = rows.filter((row) => isOnboarding(row.status)).length

  // Denominator: everyone on a weekly rhythm. See isWeeklyCheckInClient for why
  // this is deliberately not the overdue service's wider filter.
  const scheduled = rows.filter(isWeeklyCheckInClient)
  const since = Date.now() - WEEK_MS
  const checkedIn = scheduled.filter((row) => {
    const last = row.client.lastCheckInDate
    return last !== undefined && new Date(last).getTime() >= since
  }).length
  const outstanding = scheduled.length - checkedIn

  const critical = rows.filter(
    (row) => row.daysOverdue >= CRITICALLY_OVERDUE_DAYS,
  ).length

  const cells: StatBandCell[] = [
    {
      label: "Total clients",
      value: String(counts.all),
      sub: `${counts.active} active · ${onboardingCount} onboarding`,
    },
    {
      label: "Check-ins this week",
      value: `${checkedIn}/${scheduled.length}`,
      sub: `${outstanding} outstanding`,
    },
    {
      label: "Overdue check-ins",
      value: String(counts.overdue),
      sub:
        counts.overdue === 0
          ? undefined
          : critical > 0
            ? `${critical} at 4+ days`
            : `${counts.overdue} at 1-3 days`,
      subTone: "warn",
      onClick: () => router.push(rosterViewUrl("overdue")),
      actionLabel: "View overdue check-ins",
    },
    {
      // No sub: the wait would have to be measured from the moment the intake
      // was submitted, and the roster only knows when the client was invited.
      // A number that says something it cannot know is worse than no number.
      label: "Ready for review",
      value: String(counts.review),
      onClick: () => router.push(rosterViewUrl("review")),
      actionLabel: "View clients ready for review",
    },
  ]

  return <StatBand cells={cells} />
}
