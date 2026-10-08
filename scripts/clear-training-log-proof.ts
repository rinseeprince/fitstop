/**
 * Request-level proof of Clear log — `DELETE /api/client/training/events/
 * [eventId]/log` — and of the refusal that makes it necessary: a save that
 * records nothing (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md, commit 9).
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/clear-training-log-proof.ts
 *
 * Both live below what a vitest can see. The clear is one SQL function
 * (migration 181) whose cascades and belts are the database's, and both
 * handlers sit behind the client auth chain — rate limit, CSRF, auth, then
 * ownership and the day rule — so a test that mocks `supabaseAdmin` proves
 * nothing about either. This script makes two throwaway clients of the
 * owner's coach, one with a login of its own (scripts/auth-fixtures.ts) that
 * it mints a session for, writes throwaway workouts with a full detailed log
 * under each, and drives the route through a next dev it starts on a free
 * port:
 *
 *   1  a save with nothing recorded → 400 with its own sentence, log untouched
 *   2  clear → 200 { cleared: true }: the log, its exercise rows and its sets
 *      are gone, and the workout is back to scheduled with no link
 *   3  clearing again → 200 { cleared: false } — not an error
 *   4  another client's workout through this client's session → 404, and that
 *      client's log survives
 *   5  a day before the window's start (the client checks in weekly) → 403
 *      "This day is locked.", log intact; and a future day the same
 *
 * The throwaway rows, the clients and the login are removed at the end
 * whatever happens.
 */
import "./env-bootstrap";

import { createThrowawayLogin, deleteThrowawayLogin } from "./auth-fixtures";
import { supabaseAdmin } from "@/services/supabase-admin";
import { addDaysToDateString, getTodayDateStringInTimezone } from "@/lib/date-helpers";
import { endMintedSessions, mintSession, PROOF_BASE, type ProofSession } from "./proof-session";
import { startProofServer, stopProofServer } from "./proof-server";

const COACH_EMAIL = "samuel.k@taboola.com";
const TIMEZONE = "Europe/London";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.info(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

type Reply = { status: number; json: Record<string, unknown> | null };

async function send(
  session: ProofSession,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<Reply> {
  const res = await fetch(`${PROOF_BASE}${path}`, {
    method,
    headers: {
      ...session.headers,
      Origin: PROOF_BASE,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** What the proof wrote, so the cleanup removes it whatever happens. */
type Made = { clients: string[]; events: string[]; logs: string[] };

/** A workout on `date` with a full detailed log under it. Returns its ids. */
async function seedLoggedWorkout(made: Made, clientId: string, date: string, name: string) {
  const { data: event, error: eventErr } = await supabaseAdmin
    .from("training_events")
    .insert({
      client_id: clientId,
      training_plan_id: null,
      training_session_id: null,
      date,
      session_name: name,
      status: "completed",
    })
    .select("id")
    .single();
  if (eventErr || !event) throw new Error(`event insert: ${eventErr?.message}`);
  made.events.push(event.id);

  const { data: log, error: logErr } = await supabaseAdmin
    .from("session_logs")
    .insert({
      client_id: clientId,
      training_event_id: event.id,
      completed_at: date,
      completion_quality: "full",
      week_start_date: date,
    })
    .select("id")
    .single();
  if (logErr || !log) throw new Error(`session_log insert: ${logErr?.message}`);
  made.logs.push(log.id);

  const { data: exercise, error: exErr } = await supabaseAdmin
    .from("exercise_logs")
    .insert({
      session_log_id: log.id,
      performed_name: "Bench Press",
      completed: true,
    })
    .select("id")
    .single();
  if (exErr || !exercise) throw new Error(`exercise_log insert: ${exErr?.message}`);

  const { error: setErr } = await supabaseAdmin
    .from("set_logs")
    .insert([
      { exercise_log_id: exercise.id, set_number: 1, reps: 10, weight: 60 },
      { exercise_log_id: exercise.id, set_number: 2, reps: 8, weight: 65 },
    ]);
  if (setErr) throw new Error(`set_logs insert: ${setErr.message}`);

  await supabaseAdmin
    .from("training_events")
    .update({ session_log_id: log.id })
    .eq("id", event.id);

  return { eventId: event.id, logId: log.id, exerciseLogId: exercise.id };
}

async function readEvent(eventId: string) {
  const { data } = await supabaseAdmin
    .from("training_events")
    .select("status, session_log_id")
    .eq("id", eventId)
    .maybeSingle();
  return data;
}

async function countRows(table: "session_logs" | "exercise_logs" | "set_logs", column: string, value: string) {
  const { count } = await supabaseAdmin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  return count ?? 0;
}

/** Rows left on the throwaway clients, counted rather than assumed. */
async function leftOn(table: "session_logs" | "training_events" | "clients", column: "client_id" | "id", ids: string[]) {
  if (ids.length === 0) return 0;
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("*", { count: "exact", head: true })
    .in(column, ids);
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

/**
 * A throwaway client of the owner's coach, active. With a check-in schedule
 * (`schedule`) the client's logging window starts at their current check-in
 * week, so a day before it is locked; without one nothing closes a past day.
 */
async function makeClient(
  made: Made,
  coachId: string,
  name: string,
  email: string,
  schedule: { nextCheckInDue: string; startDate: string } | null
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      coach_id: coachId,
      name,
      email,
      active: true,
      onboarding_status: "active",
      timezone: TIMEZONE,
      user_id: null,
      next_check_in_due: schedule?.nextCheckInDue ?? null,
      start_date: schedule?.startDate ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`client insert: ${error?.message}`);
  made.clients.push(data.id);
  return data.id;
}

async function main() {
  const stamp = Date.now();
  const email = `clear-log-proof-${stamp}@fixture.local`;
  const made: Made = { clients: [], events: [], logs: [] };

  try {
    await startProofServer();
    const { data: coach, error: coachError } = await supabaseAdmin.from("coaches").select("id").eq("email", COACH_EMAIL).single();
    if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);
    // The signed-in client checks in weekly, a few days from now, and started a
    // month ago: their window opens at the start of this check-in week.
    const londonToday = getTodayDateStringInTimezone(TIMEZONE);
    const clientId = await makeClient(made, coach.id, "Clear-log proof · signed in", email, {
      nextCheckInDue: addDaysToDateString(londonToday, 3),
      startDate: addDaysToDateString(londonToday, -30),
    });
    await createThrowawayLogin({ role: "client", email, password: `Clear-log-${stamp}-${Math.random().toString(36).slice(2)}`, clientId });
    // Another client of the same coach: the ownership gate's counterexample.
    const otherClientId = await makeClient(made, coach.id, "Clear-log proof · another client", `clear-log-proof-other-${stamp}@fixture.local`, null);
    const session = await mintSession(email, "client");

    const me = await send(session, "GET", "/api/client/me");
    const profile = (me.json?.data ?? {}) as { id?: string; logsOpenFrom?: string | null; timezone?: string };
    if (profile.id !== clientId) throw new Error(`GET /api/client/me → ${me.status}, not the signed-in client: ${JSON.stringify(me.json)}`);
    const today = getTodayDateStringInTimezone(profile.timezone ?? "UTC");
    const openFrom = profile.logsOpenFrom ?? null;
    console.info(`\n${email} · client ${clientId} · today ${today} · logsOpenFrom ${openFrom ?? "(no bound)"}\n`);
    if (openFrom === null || openFrom > today) {
      throw new Error(`Setup: the scheduled client's window should start on or before today, not ${openFrom ?? "never"}`);
    }
    // An open day: today is always inside the window the client may log.
    const openDay = today;
    // A locked day before the window's start, and a future day, which is always refused.
    const lockedDay = addDaysToDateString(openFrom, -1);
    const futureDay = addDaysToDateString(today, 1);

    const open = await seedLoggedWorkout(made, clientId, openDay, "Clear-log proof — open day");
    const locked = await seedLoggedWorkout(made, clientId, lockedDay, "Clear-log proof — locked day");
    const future = await seedLoggedWorkout(made, clientId, futureDay, "Clear-log proof — future day");
    const foreign = await seedLoggedWorkout(made, otherClientId, openDay, "Clear-log proof — another client");

    console.info("1  a save that records nothing is refused");
    const refused = await send(
      session,
      "POST",
      `/api/client/training/events/${open.eventId}/log`,
      {
        completionQuality: "full",
        exercises: [
          { exerciseName: "Bench Press", sets: [], weightUnit: "kg", skipped: true },
        ],
      }
    );
    check("400", refused.status === 400, refused);
    check(
      "says what to do instead",
      refused.json?.error === "Tick at least one set to log this workout.",
      refused.json
    );
    check("the log is untouched", (await readEvent(open.eventId))?.session_log_id === open.logId);

    console.info("\n1b the wire no longer accepts a skip");
    const skipped = await send(
      session,
      "POST",
      `/api/client/training/events/${open.eventId}/log`,
      { completionQuality: "skipped" }
    );
    check("400", skipped.status === 400, skipped.status);

    console.info("\n2  clear takes the log, its exercise rows and its sets");
    const cleared = await send(
      session,
      "DELETE",
      `/api/client/training/events/${open.eventId}/log`
    );
    check("200", cleared.status === 200, cleared);
    check("cleared: true", (cleared.json?.data as { cleared?: boolean })?.cleared === true, cleared.json);
    const after = await readEvent(open.eventId);
    check("the workout is scheduled again", after?.status === "scheduled", after);
    check("with no link", after?.session_log_id === null, after);
    check("the log row is gone", (await countRows("session_logs", "id", open.logId)) === 0);
    check(
      "its exercise rows cascaded",
      (await countRows("exercise_logs", "session_log_id", open.logId)) === 0
    );
    check(
      "its sets cascaded",
      (await countRows("set_logs", "exercise_log_id", open.exerciseLogId)) === 0
    );

    console.info("\n3  clearing a workout that carries no log is not an error");
    const again = await send(
      session,
      "DELETE",
      `/api/client/training/events/${open.eventId}/log`
    );
    check("200", again.status === 200, again);
    check("cleared: false", (again.json?.data as { cleared?: boolean })?.cleared === false, again.json);

    console.info("\n4  another client's workout is not found");
    const stranger = await send(
      session,
      "DELETE",
      `/api/client/training/events/${foreign.eventId}/log`
    );
    check("404", stranger.status === 404, stranger);
    check(
      "their log survives",
      (await countRows("session_logs", "id", foreign.logId)) === 1
    );

    console.info("\n4b a malformed workout id");
    const malformed = await send(
      session,
      "DELETE",
      "/api/client/training/events/not-a-uuid/log"
    );
    check(
      "answers 404 or 500, never a database sentence",
      (malformed.status === 404 || malformed.status === 500) &&
        !String(malformed.json?.error ?? "").includes("invalid input syntax"),
      malformed
    );

    console.info("\n5  a day before the window's start is locked");
    const lockedReply = await send(
      session,
      "DELETE",
      `/api/client/training/events/${locked.eventId}/log`
    );
    check("403", lockedReply.status === 403, lockedReply);
    check("This day is locked.", lockedReply.json?.error === "This day is locked.", lockedReply.json);
    check(
      "the log survives",
      (await countRows("session_logs", "id", locked.logId)) === 1
    );

    console.info("\n5b a future day is locked too");
    const futureReply = await send(
      session,
      "DELETE",
      `/api/client/training/events/${future.eventId}/log`
    );
    check("403", futureReply.status === 403, futureReply);
    check("This day is locked.", futureReply.json?.error === "This day is locked.", futureReply.json);
    check(
      "the log survives",
      (await countRows("session_logs", "id", future.logId)) === 1
    );
  } finally {
    console.info("\nCleanup");
    const cleanupErrors: string[] = [];
    const logs = await supabaseAdmin.from("session_logs").delete().in("id", made.logs);
    if (logs.error) cleanupErrors.push(logs.error.message);
    const events = await supabaseAdmin.from("training_events").delete().in("id", made.events);
    if (events.error) cleanupErrors.push(events.error.message);
    const clients = await supabaseAdmin.from("clients").delete().in("id", made.clients);
    if (clients.error) cleanupErrors.push(clients.error.message);
    try {
      await deleteThrowawayLogin(email);
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
    try {
      await endMintedSessions();
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
    const left =
      (await leftOn("session_logs", "client_id", made.clients)) +
      (await leftOn("training_events", "client_id", made.clients)) +
      (await leftOn("clients", "id", made.clients));
    check(
      `cleanup: ${made.logs.length} logs, ${made.events.length} workouts, ${made.clients.length} clients and the login are gone`,
      cleanupErrors.length === 0 && left === 0,
      { cleanupErrors, left }
    );
    await stopProofServer();
  }

  console.info(
    failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
