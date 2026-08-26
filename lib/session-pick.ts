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
//   * a still-scheduled session picked on a rest day MOVES to that day and
//     opens there — one date per workout;
//   * a still-scheduled other-day session picked on a prescribed, unlogged day
//     SWAPS days with it — the cleanest calendar for "I'll do Push today and
//     Pull on Thursday";
//   * anything else — an already-done session, or any pick once today is
//     logged — is logged in place: an EXTRA on a rest day, an ALT (today's
//     slot done as another session) on a prescribed day. Logged days never
//     move.
// =============================================================================

export type SessionPickContext =
  | { kind: "rest-day"; date: string }
  | {
      kind: "prescribed-day";
      date: string;
      eventId: string;
      eventDate: string;
      /** The current event already has a log — it is pinned, so no swap. */
      logged: boolean;
    };

export type SessionPickResolution =
  | { action: "move"; moves: ClientLayoutMove[]; openEventId: string }
  | { action: "swap"; moves: ClientLayoutMove[]; openEventId: string }
  | { action: "extra"; sessionId: string }
  | { action: "alt"; sessionId: string }
  | { action: "open"; eventId: string }
  | { action: "unavailable"; reason: string };

const NO_SESSION_ROW = "That session can no longer be logged — ask your coach to re-add it";

function inPlace(
  pick: ClientTrainingWeekSession,
  action: "extra" | "alt",
): SessionPickResolution {
  if (pick.sessionId === null) return { action: "unavailable", reason: NO_SESSION_ROW };
  return { action, sessionId: pick.sessionId };
}

export function resolveSessionPick(
  pick: ClientTrainingWeekSession,
  ctx: SessionPickContext,
): SessionPickResolution {
  if (ctx.kind === "rest-day") {
    if (pick.date === ctx.date) return { action: "open", eventId: pick.eventId };
    if (!pick.isScheduled) return inPlace(pick, "extra");
    return {
      action: "move",
      moves: [{ eventId: pick.eventId, fromDate: pick.date, toDate: ctx.date }],
      openEventId: pick.eventId,
    };
  }

  if (pick.eventId === ctx.eventId) return { action: "open", eventId: pick.eventId };
  if (ctx.logged || !pick.isScheduled || pick.date === ctx.eventDate) {
    return inPlace(pick, "alt");
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
