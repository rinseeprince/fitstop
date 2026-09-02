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
 * boundary to ask what a view means — which is also why every COUNTER outside
 * the roster reaches its number through `indexUnreviewedCheckIns` from here
 * rather than spelling the queue itself. The Clients nav badge is the two
 * Attention views added up; the dashboard's card is the review half alone; both
 * go through `hooks/use-client-attention.ts`, which owns the single spelling. A
 * second spelling is how these numbers came to disagree before, twice.
 */

import type { CheckIn, ClientWithCheckInInfo } from "@/types/check-in"
import type { UnreviewedCheckIn } from "@/types/coach-brief"

export const ROSTER_VIEWS = [
  { value: "all", label: "All clients" },
  { value: "active", label: "Active" },
  { value: "onboarding", label: "Onboarding" },
  { value: "inactive", label: "Inactive" },
  { value: "overdue", label: "Overdue check-ins" },
  // An unreviewed CHECK-IN, not a submitted intake (owner decision 2026-08-29,
  // reversing the 2026-08-22 roster decision in `a1e875a`). The intake queue
  // keeps its three other entry points: the Onboarding view's own rows and
  // their `/intake-review` link, the dashboard's PendingIntakeBanner, and the
  // floating intake panel — the banner still says "ready for review" because
  // that queue is still about intakes.
  //
  // Named "Unreviewed check-ins" since 2026-08-30 (it was "Ready for review",
  // which the owner read as ambiguous about WHAT was ready). This string is the
  // one spelling: the sidebar tab, the roster's sticky title, the stat-band cell
  // and the dashboard card all render `rosterViewLabel("review")`.
  //
  // Mind the gap it opens: the label says check-ins, the counts say CLIENTS
  // (one row per client — see `indexUnreviewedCheckIns`). That is deliberate,
  // because every count sits beside the list it describes and must match the
  // rows on screen. The visible edge case is a client with two waiting: review
  // the newer one and the number does not move. A follow-up puts "2 waiting" on
  // the row itself; do NOT close the gap by counting check-ins instead.
  { value: "review", label: "Unreviewed check-ins" },
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

/** The view's full name — the sticky topbar's title, the stat-band cell, the
 *  dashboard card. Anywhere the view is named without surrounding context. */
export function rosterViewLabel(view: RosterView): string {
  return VIEW_LABELS[view]
}

/**
 * The SIDEBAR's short form, which only exists because the sidebar supplies its
 * own context: the two attention tabs sit under a "Check-ins" group heading, so
 * repeating "check-ins" in each tab both said it twice and overflowed a 200px
 * column that truncates rather than wraps (smoked 2026-08-30 — "Unreviewed
 * check-ins" clipped).
 *
 * Short ONLY here. `rosterViewLabel` stays the name everywhere the view is
 * cited without that heading above it — a dashboard card reading "DUE" or a
 * page title reading "Overdue" names nothing. A view with no short form falls
 * back to its full name, so the four roster shapes need no entry.
 */
const VIEW_NAV_LABELS: Partial<Record<RosterView, string>> = {
  overdue: "Overdue",
  // "Review due", not "Due": this app already spends "due" on the SCHEDULE —
  // `next_check_in_due`, the roster's `due 24 Aug` sub-line, the bell's "Due
  // Soon" — where it means scheduled and coming up. This queue is the opposite
  // end of the same object: submitted, and waiting on the coach. The extra word
  // is what keeps the two apart under a shared "Check-ins" heading.
  review: "Review due",
}

export function rosterViewNavLabel(view: RosterView): string {
  return VIEW_NAV_LABELS[view] ?? VIEW_LABELS[view]
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
  /** The newest check-in this client is waiting on a review for, threaded from
   *  /api/check-ins/unreviewed; null when there is none.
   *
   *  Deliberately the SAME type the coach Overview's awaiting-review row
   *  renders (`types/coach-brief.ts`), because it is the same fact: the roster
   *  queue and that row must never describe one check-in differently. */
  unreviewedCheckIn: UnreviewedCheckIn
}

export type RosterCounts = Record<RosterView, number>

/**
 * Structural, not `ClientWithCheckInInfo`: the ladder reads exactly two fields,
 * and the client details sheet has a plain `Client` in hand. Widening the
 * parameter is what stops that sheet minting a second status vocabulary.
 */
type RosterStatusFields = Pick<
  ClientWithCheckInInfo,
  "active" | "onboardingStatus"
>;

export function getRosterStatus(client: RosterStatusFields): RosterStatus {
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

const ROSTER_STATUS_LABELS: Record<RosterStatus, string> = {
  invited: "Invited",
  awaiting_review: "Awaiting review",
  awaiting_activation: "Awaiting activation",
  active: "Active",
  inactive: "Inactive",
}

/** The status as a coach reads it. */
export function rosterStatusLabel(status: RosterStatus): string {
  return ROSTER_STATUS_LABELS[status]
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

// ---------------------------------------------------------------------------
// The review queue
// ---------------------------------------------------------------------------

/** What the queue index needs off a check-in. Structural for the same reason
 *  `RosterStatusFields` is: it keeps the badge's fixtures small and lets any
 *  caller holding the queue rows pass them straight in. Module-private — both
 *  callers hand over a `CheckIn[]` and match structurally. */
type UnreviewedCheckInSource = Pick<
  CheckIn,
  "id" | "clientId" | "createdAt"
>

/**
 * The coach's unreviewed check-ins, indexed to ONE per client — the newest.
 *
 * `/api/check-ins/unreviewed` returns rows ordered `created_at DESC`, so the
 * first row seen for a client is the newest and later ones are skipped. That
 * makes this map agree by construction with the coach Overview's
 * awaiting-review row, which reads the same predicate `LIMIT 1` in the same
 * order (`services/client-overview-brief-service.ts`).
 *
 * Counting CLIENTS, not check-ins, is the point: two check-ins from one client
 * are one thing to do, and every counter sits beside a list with one row per
 * client, so it has to match the rows on screen. `useUnreviewedCheckIns().total`
 * counts rows and belongs on none of the roster, the badge or the dashboard
 * card — not even now that the view is LABELLED "Unreviewed check-ins".
 */
export function indexUnreviewedCheckIns(
  checkIns: readonly UnreviewedCheckInSource[],
): Map<string, NonNullable<UnreviewedCheckIn>> {
  const byClientId = new Map<string, NonNullable<UnreviewedCheckIn>>()
  for (const checkIn of checkIns) {
    if (byClientId.has(checkIn.clientId)) continue
    byClientId.set(checkIn.clientId, {
      id: checkIn.id,
      submittedAt: checkIn.createdAt,
    })
  }
  return byClientId
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
      // Deactivated clients are excluded even when the queue carries one of
      // their check-ins: their detail page 404s (`getClientById` is
      // active-filtered), so the row's whole point would dead-end. The queue
      // endpoint filters `active` too — this is the belt, not the braces.
      return row.status !== "inactive" && row.unreviewedCheckIn !== null
  }
}
