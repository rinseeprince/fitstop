import type { WellnessAlert } from "@/types/attention-feed"

/**
 * The key an alert is dismissed under (`attention_dismissals.alert_type`,
 * unique per coach, client and key): its type — or, for a missed-habit line,
 * its type and its habit, so each habit's line is dismissed on its own and
 * comes back when that habit is missed again on a later day (decision D4).
 * The dismiss route stores whatever key it is given; the feed matches alerts
 * to dismissals through this one function, and both surfaces post it, so the
 * three cannot disagree about what a dismissal covers.
 */
export function alertDismissalKey(alert: Pick<WellnessAlert, "type" | "habitId">): string {
  return alert.habitId ? `${alert.type}:${alert.habitId}` : alert.type
}
