import type { AttentionAlert } from "@/types/attention-feed";

/**
 * How an attention alert is WORDED, extracted verbatim from the dashboard's
 * needs-attention feed so the dashboard and the client Overview can never
 * describe the same alert differently.
 *
 * The same extraction `lib/attention-alert-destinations.ts` got for the
 * type → tab map, and for the same reason: the copy lived as two local
 * functions inside `components/dashboard/needs-attention-feed.tsx`, so a second
 * surface rendering the same alerts had no way to reuse it.
 *
 * **The `message` templates these parse are load-bearing and must not be
 * edited.** The parsing is the whole point: a trigger buries its counts in
 * prose ("3 of 7 days below 50%"), and these recover them. Edit a template in
 * `lib/*-triggers.ts` and both surfaces silently fall back to the raw message.
 */

/** The headline: a short label, counts recovered from the message. */
export function getShortAlertText(alert: AttentionAlert): string {
  const days = alert.affectedDays.length;

  switch (alert.type) {
    case "mood_drop":
      return "Mood drop";
    case "energy_drop":
      return "Energy drop";
    case "high_stress":
      return `High stress (${days} days)`;
    case "high_soreness":
      return `High soreness (${days} days)`;
    case "nutrition_missed":
      return `Nutrition missed (${days} days)`;
    case "training_missed": {
      const match = alert.message.match(/(\d+)\s+.*sessions/);
      return `${match ? match[1] : days} sessions missed`;
    }
    case "habit_dropoff": {
      const habitMatch = alert.message.match(/(\d+)\s+of.*?(\d+)\s+days/);
      return habitMatch ? `Low habits (${habitMatch[1]}/${habitMatch[2]} days)` : "Low habits";
    }
    case "activity_cal_mismatch":
      return "Overeating on rest days";
    case "partial_training_pattern":
      return `${days} sessions partial`;
    case "no_engagement":
      return "No recent activity";
    default:
      return alert.message;
  }
}

/** The fuller sentence: what the alert actually observed. */
export function getPriorityAlertText(alert: AttentionAlert): string {
  const days = alert.affectedDays.length;

  switch (alert.type) {
    case "mood_drop": {
      const avg =
        alert.metricData.length > 0
          ? (
              alert.metricData.reduce((sum, d) => sum + d.value, 0) /
              alert.metricData.length
            ).toFixed(1)
          : "low";
      return `Mood dropped to avg ${avg} for ${days} days`;
    }
    case "energy_drop": {
      const avg =
        alert.metricData.length > 0
          ? (
              alert.metricData.reduce((sum, d) => sum + d.value, 0) /
              alert.metricData.length
            ).toFixed(1)
          : "low";
      return `Energy dropped to avg ${avg} for ${days} days`;
    }
    case "high_stress":
      return `Stress at 8+ for ${days} days`;
    case "high_soreness":
      return `Soreness at 8+ for ${days} days`;
    case "nutrition_missed":
      return `Nutrition targets missed for ${days} days`;
    case "training_missed": {
      const match = alert.message.match(/(\d+)\s+training sessions/);
      const count = match ? match[1] : days;
      return `Missed ${count} sessions this week`;
    }
    case "habit_dropoff":
      return alert.message;
    case "activity_cal_mismatch":
      return "Calorie intake matched activities despite skipping them";
    case "partial_training_pattern":
      return `${days} of recent sessions only partially completed`;
    default:
      return alert.message;
  }
}

/**
 * The two lines of one alert row.
 *
 * `sub` is null when the fuller sentence would only repeat the headline, which
 * happens for any type neither switch names — `no_log_gap` falls through both
 * `default` branches to the same `alert.message`. A row that printed the same
 * string twice would read as a rendering bug.
 */
export function alertLines(alert: AttentionAlert): { title: string; sub: string | null } {
  const title = getShortAlertText(alert);
  const sub = getPriorityAlertText(alert);
  return { title, sub: sub === title ? null : sub };
}

/**
 * Alerts worth showing, with the redundant one suppressed.
 *
 * Both alerts read the one definition of a logged day (`lib/logged-days.ts`).
 * `no_log_gap` fires on a run of consecutive unlogged days between, or after,
 * the client's logged days. `no_engagement` fires when a client with
 * prescribed work has no logged day in the silence window. The second is
 * strictly stronger, so a client who trips it usually trips both, and the coach
 * reads two rows describing one silence.
 *
 * Suppression rather than a merge, deliberately: dismissals are keyed by alert
 * TYPE (`attention_dismissals`), so a merged row's × would have to dismiss two
 * types or leave the survivor to reappear on the next revalidate. Hiding one
 * keeps the dismissal 1:1, and the hidden alert returns by itself the moment
 * `no_engagement` clears.
 *
 * Renderer-only. The evaluator and the dashboard feed are untouched.
 */
export function visibleAlerts(alerts: AttentionAlert[]): AttentionAlert[] {
  const hasNoEngagement = alerts.some((alert) => alert.type === "no_engagement");
  if (!hasNoEngagement) return alerts;
  return alerts.filter((alert) => alert.type !== "no_log_gap");
}
