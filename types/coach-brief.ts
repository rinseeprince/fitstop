import type { AttentionAlert } from "@/types/attention-feed";

/**
 * The most-recent check-in awaiting coach review, or null if none.
 * `submittedAt` is `check_ins.created_at`.
 */
export type UnreviewedCheckIn = {
  id: string;
  submittedAt: string;
} | null;

/**
 * One item in the since-last-visit activity feed (newest first, capped).
 * `at` is the feed timeline anchor: when the row became visible to the coach
 * (created_at), not the day it is attributed to.
 */
export type ActivityItem =
  | { type: "check_in"; at: string }
  | {
      type: "measurement";
      at: string;
      metricKey: string;
      /** Canonical kg/cm. The unit label is resolved at the render boundary from
       *  METRIC_DEFINITIONS + the viewer's preference, never server-side. */
      value: number;
      previousValue: number | null;
    }
  | { type: "pr"; at: string; exerciseName: string; weight: number; previousBest: number }
  | { type: "session_completed"; at: string; sessionName: string; exerciseCount: number };

/**
 * Check-in schedule state for the Client & Schedule card, built by the existing
 * check-in-tracking-service (client-local today; daysUntilDue sign convention:
 * negative = days until due, positive = days overdue).
 */
export type CheckInTiming = {
  frequency: string;
  expectedCheckInDay: string | null;
  lastSubmittedAt: string | null;
  nextDueDate: string | null;
  daysUntilDue: number | null;
  isOverdue: boolean;
};

/**
 * The coach overview "pre-session brief". `lastViewedAt` is null on first visit
 * (the UI shows a first-visit state instead of the activity feed). The GET that
 * serves this is read-only — the anchor moves only via POST …/overview-brief/seen.
 */
export type OverviewBrief = {
  lastViewedAt: string | null;
  waitingOnYou: {
    unreviewedCheckIn: UnreviewedCheckIn;
    attentionAlerts: AttentionAlert[];
  };
  activity: ActivityItem[];
  checkInTiming: CheckInTiming | null;
};
