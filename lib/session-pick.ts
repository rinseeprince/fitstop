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
//   * picked on a prescribed, unlogged day, it SWAPS days with that day's
//     session — the cleanest calendar for "I'll do Push today and Pull on
//     Thursday";
//   * picked once today is already logged, it is an ALT: today's log is
//     rewritten as that session. Logged days never move.
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
  if (ctx.logged || pick.date === ctx.eventDate) {
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
