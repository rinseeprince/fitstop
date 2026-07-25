import type { AttentionAlert } from "@/types/attention-feed";

/** The most-recent check-in awaiting coach review, or null if none. */
export type UnreviewedCheckIn = {
  id: string;
  createdAt: string;
  status: string;
} | null;

/** Counts of activity since the coach's last visit (Session 7.6). */
export type SinceLastVisit = {
  newCheckIns: number;
  newLogs: number;
  newBodyMetrics: number;
  newWorkoutsLogged: number;
  eventStatusChanges: number;
};

/**
 * The coach overview "pre-session brief". `lastViewedAt` is null on first visit
 * (the UI shows a first-visit state instead of since-last-visit counts).
 */
export type OverviewBrief = {
  lastViewedAt: string | null;
  waitingOnYou: {
    unreviewedCheckIn: UnreviewedCheckIn;
    attentionAlerts: AttentionAlert[];
  };
  sinceLastVisit: SinceLastVisit;
};
