import { describe, expect, it } from "vitest";
import {
  alertLines,
  getPriorityAlertText,
  getShortAlertText,
  visibleAlerts,
} from "./attention-alert-copy";
import type { AlertType, AttentionAlert } from "@/types/attention-feed";

// This module was EXTRACTED from components/dashboard/needs-attention-feed.tsx.
// These tests exist first to pin the dashboard's rendered strings, so the
// extraction is provably behaviour-identical rather than merely intended to be.

const alert = (over: Partial<AttentionAlert> & { type: AlertType }): AttentionAlert => ({
  severity: "medium",
  message: "",
  affectedDays: [],
  metricData: [],
  ...over,
});

const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-08-${10 + i}`);

describe("getShortAlertText", () => {
  it("names the wellness drops without a count", () => {
    expect(getShortAlertText(alert({ type: "mood_drop" }))).toBe("Mood drop");
    expect(getShortAlertText(alert({ type: "energy_drop" }))).toBe("Energy drop");
  });

  it("counts affected days for the sustained wellness alerts", () => {
    expect(getShortAlertText(alert({ type: "high_stress", affectedDays: days(3) }))).toBe(
      "High stress (3 days)"
    );
    expect(getShortAlertText(alert({ type: "high_soreness", affectedDays: days(4) }))).toBe(
      "High soreness (4 days)"
    );
    expect(
      getShortAlertText(alert({ type: "nutrition_missed", affectedDays: days(2) }))
    ).toBe("Nutrition missed (2 days)");
  });

  it("recovers the session count from the training_missed message", () => {
    expect(
      getShortAlertText(
        alert({ type: "training_missed", message: "Missed 4 training sessions this week" })
      )
    ).toBe("4 sessions missed");
  });

  it("falls back to the affected-day count when training_missed has no number", () => {
    expect(
      getShortAlertText(
        alert({ type: "training_missed", message: "sessions missed", affectedDays: days(2) })
      )
    ).toBe("2 sessions missed");
  });

  it("recovers both numbers from the habit_dropoff message", () => {
    expect(
      getShortAlertText(
        alert({ type: "habit_dropoff", message: "Completed 3 of 7 days below 50%" })
      )
    ).toBe("Low habits (3/7 days)");
  });

  it("degrades habit_dropoff to a bare label when the message does not parse", () => {
    expect(getShortAlertText(alert({ type: "habit_dropoff", message: "habits low" }))).toBe(
      "Low habits"
    );
  });

  it("uses fixed labels for the remaining types", () => {
    expect(getShortAlertText(alert({ type: "activity_cal_mismatch" }))).toBe(
      "Overeating on rest days"
    );
    expect(
      getShortAlertText(alert({ type: "partial_training_pattern", affectedDays: days(3) }))
    ).toBe("3 sessions partial");
    expect(getShortAlertText(alert({ type: "no_engagement" }))).toBe("No recent activity");
  });

  it("falls back to the raw message for a type it does not name", () => {
    expect(
      getShortAlertText(alert({ type: "no_log_gap", message: "No daily logs for 3 consecutive days" }))
    ).toBe("No daily logs for 3 consecutive days");
  });
});

describe("getPriorityAlertText", () => {
  it("averages the metric data for the wellness drops", () => {
    const withData = alert({
      type: "mood_drop",
      affectedDays: days(3),
      metricData: [
        { date: "2026-08-10", value: 2 },
        { date: "2026-08-11", value: 3 },
      ],
    });
    expect(getPriorityAlertText(withData)).toBe("Mood dropped to avg 2.5 for 3 days");
  });

  it("says 'low' when a wellness drop carries no metric data", () => {
    expect(
      getPriorityAlertText(alert({ type: "energy_drop", affectedDays: days(2) }))
    ).toBe("Energy dropped to avg low for 2 days");
  });

  it("recovers the count from the training_missed message", () => {
    expect(
      getPriorityAlertText(
        alert({ type: "training_missed", message: "Missed 3 training sessions this week" })
      )
    ).toBe("Missed 3 sessions this week");
  });

  it("passes habit_dropoff through verbatim", () => {
    const message = "Completed 2 of 7 days below 50%";
    expect(getPriorityAlertText(alert({ type: "habit_dropoff", message }))).toBe(message);
  });

  it("falls back to the raw message for a type it does not name", () => {
    const message = "No activity logged in the last 3 days";
    expect(getPriorityAlertText(alert({ type: "no_engagement", message }))).toBe(message);
  });
});

describe("alertLines", () => {
  it("pairs the short headline with the fuller sentence", () => {
    expect(
      alertLines(alert({ type: "high_stress", affectedDays: days(3) }))
    ).toEqual({ title: "High stress (3 days)", sub: "Stress at 8+ for 3 days" });
  });

  it("drops the sub-line when it would repeat the headline", () => {
    // no_log_gap falls through BOTH default branches to the same message.
    const message = "No daily logs for 3 consecutive days";
    expect(alertLines(alert({ type: "no_log_gap", message }))).toEqual({
      title: message,
      sub: null,
    });
  });

  it("keeps a sub-line for a type with a short label but no priority text", () => {
    const message = "No activity logged in the last 3 days";
    expect(alertLines(alert({ type: "no_engagement", message }))).toEqual({
      title: "No recent activity",
      sub: message,
    });
  });
});

describe("visibleAlerts", () => {
  it("hides no_log_gap while no_engagement is live", () => {
    const list = [
      alert({ type: "no_log_gap" }),
      alert({ type: "no_engagement" }),
      alert({ type: "high_stress" }),
    ];
    expect(visibleAlerts(list).map((a) => a.type)).toEqual(["no_engagement", "high_stress"]);
  });

  it("shows no_log_gap on its own", () => {
    const list = [alert({ type: "no_log_gap" }), alert({ type: "mood_drop" })];
    expect(visibleAlerts(list).map((a) => a.type)).toEqual(["no_log_gap", "mood_drop"]);
  });

  it("returns the suppressed alert once no_engagement clears", () => {
    const gap = alert({ type: "no_log_gap" });
    expect(visibleAlerts([gap, alert({ type: "no_engagement" })])).not.toContain(gap);
    expect(visibleAlerts([gap])).toContain(gap);
  });

  it("leaves order and identity untouched when nothing is suppressed", () => {
    const list = [alert({ type: "mood_drop" }), alert({ type: "training_missed" })];
    expect(visibleAlerts(list)).toEqual(list);
  });
});
