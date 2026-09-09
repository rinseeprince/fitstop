import type { TriggerResult } from "./attention-triggers"
import type { AlertType } from "@/types/attention-feed"
import { PLAN_ENDING_LEAD_DAYS } from "@/lib/constants"
import { addDaysToDateString, formatDateOnlyShort } from "@/lib/date-helpers"
import { daysBetween } from "@/utils/metric-points"

/** One plan's window on the calendar, both ends inclusive, YYYY-MM-DD. */
export type PlanWindow = { start: string; end: string }

/** A window with the client it belongs to — the shape the cross-client readers return. */
export type ClientPlanWindow = PlanWindow & { clientId: string }

/** A journey block's name and window — the block a message names, never a bound. */
export type BlockWindow = PlanWindow & { name: string }

export type ClientBlockWindow = BlockWindow & { clientId: string }

type PrescriptionTrack = "nutrition" | "training"

/**
 * The next stretch of days with no prescription: the one containing `today`
 * when today is uncovered, else the first one after today.
 */
type PrescriptionGap = {
  /** The first day nothing covers. */
  from: string
  /** The day a queued plan resumes after the gap; null when nothing is queued. */
  resumesOn: string | null
}

/**
 * Walks a client's plan windows from `today` and reports where the prescription
 * next stops. Windows are merged into stretches first, so a plan queued to start
 * the day after the current one ends is continuous coverage and not a gap.
 *
 * Returns null for a client with no window at all, and for one whose every
 * window is still ahead: a queued first plan is a client being set up, the
 * activation banner's business, not a prescription that stopped.
 */
export function findPrescriptionGap(
  windows: readonly PlanWindow[],
  today: string,
): PrescriptionGap | null {
  const sorted = windows
    .filter((window) => window.end >= window.start)
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))

  const stretches: PlanWindow[] = []
  for (const window of sorted) {
    const last = stretches[stretches.length - 1]
    if (last && window.start <= addDaysToDateString(last.end, 1)) {
      if (window.end > last.end) last.end = window.end
    } else {
      stretches.push({ ...window })
    }
  }
  if (stretches.length === 0) return null

  const coveringIndex = stretches.findIndex(
    (stretch) => stretch.start <= today && today <= stretch.end,
  )
  if (coveringIndex >= 0) {
    return {
      from: addDaysToDateString(stretches[coveringIndex].end, 1),
      resumesOn: stretches[coveringIndex + 1]?.start ?? null,
    }
  }

  // Today is uncovered: the gap began the day after the latest stretch that
  // ended before today. Stretches are disjoint and sorted, so the last one
  // ending before today is the one.
  let ended: PlanWindow | null = null
  for (const stretch of stretches) {
    if (stretch.end < today) ended = stretch
  }
  if (!ended) return null

  return {
    from: addDaysToDateString(ended.end, 1),
    resumesOn: stretches.find((stretch) => stretch.start > today)?.start ?? null,
  }
}

const TRACK_COPY: Record<
  PrescriptionTrack,
  { type: AlertType; ending: string; none: string; unset: string }
> = {
  nutrition: {
    type: "nutrition_ending",
    ending: "Nutrition targets end",
    none: "No nutrition targets",
    unset: "targets set",
  },
  training: {
    type: "training_ending",
    ending: "Training ends",
    none: "No training scheduled",
    unset: "program placed",
  },
}

const blockCovering = (blocks: readonly BlockWindow[], date: string): BlockWindow | undefined =>
  blocks.find((block) => block.start <= date && date <= block.end)

const firstBlockAfter = (blocks: readonly BlockWindow[], date: string): BlockWindow | undefined =>
  [...blocks].filter((block) => block.start > date).sort((a, b) => a.start.localeCompare(b.start))[0]

interface PrescriptionEndingParams {
  track: PrescriptionTrack
  windows: readonly PlanWindow[]
  /**
   * The client's journey blocks, so the message can name the one the stop
   * falls in. Blocks are context here, never a bound: with none, or with none
   * covering the day in question, the message is the plain form.
   */
  blocks?: readonly BlockWindow[]
  /** The feed's window end — the coach-local today every day-deciding trigger judges on. */
  today: string
}

/**
 * Flags a client whose prescription on one track stops with nothing after it.
 *
 * Two states, and a planned rest is neither:
 * - HIGH once the stop has happened and nothing is queued — the client's food
 *   log is refused on a day no version covers, and no surface told the coach.
 *   Anchored on today, so a dismissal lasts the day and it returns until the
 *   coach sets targets, places a program, or deletes the plan.
 * - MEDIUM while the stop is inside the final `PLAN_ENDING_LEAD_DAYS`,
 *   whether or not a plan is queued after the gap — the heads-up says what
 *   is queued. Anchored on the first day of the lead window, which is fixed
 *   for that end date, so one dismissal covers the whole heads-up and a later
 *   end date brings it back (see filterDismissedAlerts).
 * - A gap already under way with a plan queued after it is a holiday or a
 *   rest period the coach laid out, and nothing fires.
 *
 * A client with blocks gets the block named (owner, 2026-09-10): the HIGH
 * names the block the client is sitting in with nothing ("…, in Cut"); the
 * MEDIUM names the block the last day falls in — "the last day of Build" when
 * the prescription ends with its block, "inside Build" when it stops before
 * its block does — and, when nothing is queued on the track and a block
 * follows, that the next block has nothing set, in the block card's own words.
 */
export function evaluatePrescriptionEnding({
  track,
  windows,
  blocks = [],
  today,
}: PrescriptionEndingParams): TriggerResult | null {
  const gap = findPrescriptionGap(windows, today)
  if (!gap) return null
  const copy = TRACK_COPY[track]

  if (gap.from <= today) {
    if (gap.resumesOn) return null
    const holder = blockCovering(blocks, today)
    return {
      type: copy.type,
      severity: "high",
      message:
        `${copy.none} from ${formatDateOnlyShort(gap.from)}` +
        (holder ? `, in ${holder.name}` : ""),
      affectedDays: [today],
      metricData: [],
    }
  }

  const lastDay = addDaysToDateString(gap.from, -1)
  if (daysBetween(today, lastDay) >= PLAN_ENDING_LEAD_DAYS) return null

  let message = `${copy.ending} ${formatDateOnlyShort(lastDay)}`
  const holder = blockCovering(blocks, lastDay)
  const endsWithBlock = holder !== undefined && holder.end === lastDay
  if (holder) message += endsWithBlock ? `, the last day of ${holder.name}` : `, inside ${holder.name}`
  if (gap.resumesOn) {
    message += `, nothing until ${formatDateOnlyShort(gap.resumesOn)}`
  } else if (endsWithBlock) {
    const next = firstBlockAfter(blocks, lastDay)
    if (next) message += `, and ${next.name} has no ${copy.unset}`
  }
  return {
    type: copy.type,
    severity: "medium",
    message,
    affectedDays: [addDaysToDateString(lastDay, -(PLAN_ENDING_LEAD_DAYS - 1))],
    metricData: [],
  }
}
