/**
 * The Clients roster's vocabulary: its views, its status ladder, and the pure
 * predicates that put a client in a view.
 *
 * This module is the single owner of the `?view=` query param. Views are
 * linkable on purpose: a notification or the Needs Attention feed deep-links
 * straight into a queue (`/clients?view=overdue`), and a refresh leaves the
 * coach where they were. Keep every writer of the param going through
 * `rosterViewUrl` so the canonical form stays in one place — "all" is the bare
 * `/clients`, never `?view=all`.
 *
 * Everything here is pure and framework-free. `hooks/use-roster.ts` is the
 * fetch-and-memo layer on top; nothing should have to cross a "use client"
 * boundary to ask what a view means.
 */

import type { ClientWithCheckInInfo } from "@/types/check-in"

export const ROSTER_VIEWS = [
  { value: "all", label: "All clients" },
  { value: "active", label: "Active" },
  { value: "onboarding", label: "Onboarding" },
  { value: "inactive", label: "Inactive" },
  { value: "overdue", label: "Overdue check-ins" },
  { value: "review", label: "Ready for review" },
] as const

export type RosterView = (typeof ROSTER_VIEWS)[number]["value"]

/** The four roster-shape views, above the Attention divider. */
export const ROSTER_SHAPE_VIEWS = ["all", "active", "onboarding", "inactive"] as const

/** The two attention queues, below the divider. */
export const ROSTER_ATTENTION_VIEWS = ["overdue", "review"] as const

/**
 * Compile-time proof that every view is in exactly one sidebar group.
 *
 * `rosterViewLabel` already catches a typo in either array, but an OMISSION was
 * invisible: a seventh view would get a label, a count, a URL and a filter, and
 * simply never appear in the sidebar. This errors while a view is ungrouped.
 */
type UngroupedView = Exclude<
  RosterView,
  (typeof ROSTER_SHAPE_VIEWS)[number] | (typeof ROSTER_ATTENTION_VIEWS)[number]
>
const _everyViewIsGrouped: UngroupedView extends never ? true : never = true
void _everyViewIsGrouped

const VIEW_LABELS: Record<RosterView, string> = ROSTER_VIEWS.reduce(
  (acc, view) => ({ ...acc, [view.value]: view.label }),
  {} as Record<RosterView, string>,
)

/** The view's name — the sidebar tab, and the sticky topbar's title. */
export function rosterViewLabel(view: RosterView): string {
  return VIEW_LABELS[view]
}

const VALID_VIEWS = new Set<string>(ROSTER_VIEWS.map((view) => view.value))

/** The view a `?view=` param addresses; anything unrecognised falls back to "all". */
export function resolveRosterView(param: string | null | undefined): RosterView {
  return param && VALID_VIEWS.has(param) ? (param as RosterView) : "all"
}

/** The canonical URL for a view. "all" is the bare path, so the default view
 *  never carries a redundant param into a bookmark or a share. */
export function rosterViewUrl(view: RosterView): string {
  return view === "all" ? "/clients" : `/clients?view=${view}`
}

// ---------------------------------------------------------------------------
// Status ladder
// ---------------------------------------------------------------------------

/** The roster's status vocabulary — the client's onboarding stage, with
 *  deactivation winning over all of it. */
export type RosterStatus =
  | "invited"
  | "awaiting_review"
  | "awaiting_activation"
  | "active"
  | "inactive"

export type RosterRow = {
  client: ClientWithCheckInInfo
  /** Days past the expected check-in date, threaded from /api/clients/overdue;
   *  0 when the client is not overdue. */
  daysOverdue: number
  status: RosterStatus
}

export type RosterCounts = Record<RosterView, number>

export function getRosterStatus(client: ClientWithCheckInInfo): RosterStatus {
  if (!client.active) return "inactive"
  switch (client.onboardingStatus) {
    case "pending_intake":
      return "invited"
    case "intake_completed":
      return "awaiting_review"
    case "setup_in_progress":
      return "awaiting_activation"
    default:
      return "active"
  }
}

/** The three stages that make up the Onboarding view. */
export function isOnboarding(status: RosterStatus): boolean {
  return (
    status === "invited" ||
    status === "awaiting_review" ||
    status === "awaiting_activation"
  )
}

/**
 * Whether a client is on a weekly check-in rhythm, and so belongs in the
 * denominator of a "this week" measure.
 *
 * Deliberately NOT the filter `getOverdueClients` applies (`active` plus any
 * cadence but "none"). A monthly client is genuinely expected once a month, so
 * counting them every week reports a client who is perfectly on schedule as a
 * shortfall three weeks in four — inventing the very gap the measure exists to
 * find. `status !== "inactive"` IS `client.active`, so onboarding clients stay
 * counted: they can be overdue, and the roster shows them as such.
 */
export function isWeeklyCheckInClient(row: RosterRow): boolean {
  const { checkInFrequency, checkInFrequencyDays } = row.client
  if (row.status === "inactive") return false
  if (checkInFrequency === "weekly") return true
  return checkInFrequency === "custom" && checkInFrequencyDays === 7
}

/** Whether a row belongs in a view. No `default` branch on purpose: adding a
 *  view without handling it here fails the build (TS2366 under `strict`). */
export function matchesRosterView(row: RosterRow, view: RosterView): boolean {
  switch (view) {
    case "all":
      return true
    case "active":
      return row.status === "active"
    case "onboarding":
      return isOnboarding(row.status)
    case "inactive":
      return row.status === "inactive"
    case "overdue":
      return row.daysOverdue > 0
    case "review":
      return row.status === "awaiting_review"
  }
}
