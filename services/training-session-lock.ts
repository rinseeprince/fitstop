import { format } from "date-fns";
import { supabaseAdmin } from "./supabase-admin";

// A logged day's prescription is frozen: a coach edit that would rewrite the
// exercises under a session the client has logged is refused with a sentence
// naming the day (`assertSessionUnlogged`), and it fails loudly on a read error
// rather than letting a write through the guard.

/**
 * The app's date spelling, month-first — `EEE, MMM d`, as used by the calendar
 * tray's header, the delete dialogs, the metric and exercise charts and the
 * check-in surfaces. The message below is read beside those, so it follows the
 * convention rather than setting a second one.
 *
 * **`placed-session-editor.tsx`'s standing lock line is the same sentence as
 * `loggedMessage` and spells the same pattern — the two must keep agreeing.**
 * Both follow the convention rather than each other, so if it moves, both move.
 *
 * date-fns rather than `toLocaleDateString`, so the pattern is spelled the way
 * the rest of the app spells it and no `Intl` call lives outside
 * `lib/date-helpers.ts` (CONVENTIONS §6).
 */
function formatDay(date: string): string {
  return format(new Date(date + "T00:00:00"), "EEE, MMM d");
}

type SessionEventLink = {
  id: string;
  date: string;
  status: string;
};

/**
 * The calendar events linked to one placed session, client-scoped.
 *
 * **It must keep returning past and NON-SCHEDULED events, because
 * `assertSessionUnlogged` below is the caller that needs them** — narrowing this
 * to `status = 'scheduled'` would leave that assertion nothing to find and
 * silently disable the logged-day lock.
 *
 * The list shape is earned by `assertSessionUnlogged`'s `find` over the
 * date-ascending list (it names the EARLIEST logged day) and the tray's
 * `loggedEvent`, which asks the same question in the browser.
 */
export async function getSessionEventLinks(
  sessionId: string,
  clientId: string,
): Promise<SessionEventLink[]> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("id, date, status")
    .eq("training_session_id", sessionId)
    .eq("client_id", clientId)
    .order("date", { ascending: true });

  if (error) throw new Error(`Failed to fetch session events: ${error.message}`);

  return (data ?? []).map((e) => ({ id: e.id, date: e.date, status: e.status }));
}

/**
 * Thrown when a coach edit would rewrite the prescription under a day the
 * client has already logged. Routes translate it to 409.
 */
export class SessionLoggedError extends Error {}

function loggedMessage(date: string): string {
  return `The client logged this session on ${formatDay(date)}, so it can no longer be edited`;
}

/**
 * Throws SessionLoggedError when any event linked to `sessionId` has left the
 * `scheduled` state.
 *
 * **The predicate is `status !== "scheduled"`, and it is deliberately the same
 * sentence `program-builder-lock-model.ts:63` says** — the plan builder locks a
 * slot on exactly this test, so the two surfaces cannot disagree about whether
 * a session is editable. Three places now spell it: that line, this assertion,
 * and the placed-session tray's own gate (`use-placed-session-editor.ts`, which
 * cannot import this module — it reaches `supabaseAdmin`). Whoever changes the
 * rule changes all three.
 *
 * Called INSIDE `replaceSessionFull` rather than at its route, so a future
 * caller inherits it. It runs AFTER the service proves the session belongs to
 * the client, so a foreign sessionId still reads as not found rather than as
 * locked.
 *
 * Links come back date-ascending, so the message names the EARLIEST logged
 * occurrence. A read failure propagates as `getSessionEventLinks`' own error:
 * a failed read must never be mistaken for "nothing is logged".
 */
export async function assertSessionUnlogged(
  sessionId: string,
  clientId: string,
): Promise<void> {
  const links = await getSessionEventLinks(sessionId, clientId);
  const logged = links.find((e) => e.status !== "scheduled");
  if (logged) throw new SessionLoggedError(loggedMessage(logged.date));
}
