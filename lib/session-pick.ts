import type {
  ClientLayoutMove,
  ClientTrainingWeekSession,
} from "@/types/client-training-week";

// =============================================================================
// What does picking a session from the week mean?
//
// One pure kernel answers it for both entry points — the rest-day "Log a
// session" picker and "Do a different session" on a prescribed day — so the
// two screens cannot drift on the rule (CONVENTIONS §2, no duplicate logic).
// The rules are the owner's (2026-08-26):
//   * only a session that can still be done is pickable — the picker offers
//     Today / Upcoming / Missed-but-still-scheduled and nothing else, because
//     a done session has nothing left to do and offering it again only invites
//     a duplicate log;
//   * picked on a rest day, it MOVES to that day and opens there — one date
//     per workout;
//   * picked from the same day as the session in hand, it OPENS — a day can
//     hold several sessions, each its own workout, so there is nothing to move;
//   * picked from another day while the session in hand is unlogged, the two
//     SWAP days — the cleanest calendar for "I'll do Push today and Pull on
//     Thursday"; each joins its new day after the sessions already there;
//   * picked from another day once the session in hand is logged, it is an
//     ALT: that log is rewritten as the picked session. Logged days never move.
// =============================================================================

type SessionPickContext =
  | { kind: "rest-day"; date: string }
  | {
      kind: "prescribed-day";
      date: string;
      eventId: string;
      eventDate: string;
      /** The current event already has a log — it is pinned, so no swap. */
      logged: boolean;
    };

type SessionPickResolution =
  | { action: "move"; moves: ClientLayoutMove[]; openEventId: string }
  | { action: "swap"; moves: ClientLayoutMove[]; openEventId: string }
  | { action: "alt"; sessionId: string }
  | { action: "open"; eventId: string }
  | { action: "unavailable"; reason: string };

const ALREADY_DONE = "That session has already been done";
const NO_SESSION_ROW = "That session can no longer be logged — ask your coach to re-add it";

export function resolveSessionPick(
  pick: ClientTrainingWeekSession,
  ctx: SessionPickContext,
): SessionPickResolution {
  if (ctx.kind === "rest-day") {
    if (!pick.isScheduled) return { action: "unavailable", reason: ALREADY_DONE };
    if (pick.date === ctx.date) return { action: "open", eventId: pick.eventId };
    return {
      action: "move",
      moves: [{ eventId: pick.eventId, fromDate: pick.date, toDate: ctx.date }],
      openEventId: pick.eventId,
    };
  }

  if (pick.eventId === ctx.eventId) return { action: "open", eventId: pick.eventId };
  if (!pick.isScheduled) return { action: "unavailable", reason: ALREADY_DONE };
  if (pick.date === ctx.eventDate) return { action: "open", eventId: pick.eventId };
  if (ctx.logged) {
    if (pick.sessionId === null) return { action: "unavailable", reason: NO_SESSION_ROW };
    return { action: "alt", sessionId: pick.sessionId };
  }
  return {
    action: "swap",
    moves: [
      { eventId: pick.eventId, fromDate: pick.date, toDate: ctx.eventDate },
      { eventId: ctx.eventId, fromDate: ctx.eventDate, toDate: pick.date },
    ],
    openEventId: pick.eventId,
  };
}
