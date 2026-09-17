// RN contract: the client's training week, as the session picker and the
// (later) week view read it. One row per training event in the check-in-
// anchored week containing the requested date. `state` is the only derivation
// the client needs — done / today / upcoming / missed — so no consumer has to
// re-derive it from `status` + `date` against its own clock.

export type ClientTrainingWeekSessionState = "done" | "today" | "upcoming" | "missed";

export type ClientTrainingWeekSession = {
  eventId: string;
  // The placed session row behind the event; null only for a legacy row whose
  // session was hard-deleted. The event-less (extra) log path needs it.
  sessionId: string | null;
  name: string;
  focus: string | null;
  date: string; // YYYY-MM-DD
  state: ClientTrainingWeekSessionState;
  // Whether a layout write may move it: `status === 'scheduled'`. `state` says
  // where the session stands on the calendar and cannot answer this — a session
  // never logged on a day that has passed reads "missed" and CAN still be
  // moved, while one that has left `scheduled` cannot, whatever its state
  // reads. Clearing its log puts it back to scheduled and movable.
  isScheduled: boolean;
};

// One entry of a layout write (`POST /api/client/training/events/layout`).
// `fromDate` is the day the client SAW the session on — the drift check.
export type ClientLayoutMove = { eventId: string; fromDate: string; toDate: string };

export type ClientTrainingWeek = {
  weekStart: string; // YYYY-MM-DD
  weekEnd: string; // YYYY-MM-DD
  today: string; // the client's device-zone today, YYYY-MM-DD
  sessions: ClientTrainingWeekSession[]; // by date, each day's sessions in the day's order
};
