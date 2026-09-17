/**
 * Request-level proof of Clear log — `DELETE /api/client/training/events/
 * [eventId]/log` — and of the refusal that makes it necessary: a save that
 * records nothing (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md, commit 9).
 *
 *   npx tsx scripts/clear-training-log-proof.ts
 *
 * Both live below what a vitest can see. The clear is one SQL function
 * (migration 181) whose cascades and belts are the database's, and both
 * handlers sit behind the client auth chain — rate limit, CSRF, auth, then
 * ownership and the day rule — so a test that mocks `supabaseAdmin` proves
 * nothing about either. This script mints a real session for a DEV client,
 * writes a throwaway workout with a full detailed log under it, and drives the
 * route:
 *
 *   1  a save with nothing recorded → 400 with its own sentence, log untouched
 *   2  clear → 200 { cleared: true }: the log, its exercise rows and its sets
 *      are gone, and the workout is back to scheduled with no link
 *   3  clearing again → 200 { cleared: false } — not an error
 *   4  another client's workout through this client's session → 404, and that
 *      client's log survives
 *   5  a day outside the open window → 403 "This day is locked.", log intact
 *
 * The throwaway rows are removed at the end whatever happens.
 */
import "./env-bootstrap";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/services/supabase-admin";

const BASE = process.env.WIRE_PROOF_BASE ?? "http://localhost:3000";
// DEV clients with an auth user. The proof needs one whose logging window is
// OPEN today — the boundary moves with each client's check-in schedule — so it
// tries them in turn and says which it used. A second client, whichever it is
// not, proves the ownership gate.
const CLIENT_EMAILS = [
  "s.kalepa91+intake@gmail.com",
  "s.kalepa91+besttest@gmail.com",
  "s.kalepa91+nogoal@gmail.com",
  "s.kalepa91+complete@gmail.com",
  "s.kalepa91+ot7@gmail.com",
  "s.kalepa91+ot4@gmail.com",
];

const SUPABASE_URL = need("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
const ANON_KEY = need("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);

function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.info(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function mintSession(email: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.email_otp) {
    throw new Error(`generateLink failed for ${email}: ${linkError?.message ?? "no otp"}`);
  }
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (verifyError || !verified.session) {
    throw new Error(`verifyOtp failed for ${email}: ${verifyError?.message ?? "no session"}`);
  }
  const jar = new Map<string, string>();
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error: setError } = await ssr.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (setError) throw new Error(`setSession failed for ${email}: ${setError.message}`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

type Reply = { status: number; json: Record<string, unknown> | null };

async function send(
  cookie: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<Reply> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      Origin: BASE,
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

/** A workout on `date` with a full detailed log under it. Returns its ids. */
async function seedLoggedWorkout(clientId: string, date: string, name: string) {
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

type Subject = {
  cookie: string;
  clientId: string;
  email: string;
  today: string;
  openFrom: string | null;
};

/** The first client whose logging window is open today. */
async function findSubject(): Promise<{ subject: Subject; otherClientId: string }> {
  const seen: { email: string; clientId: string; openFrom: string | null; today: string }[] = [];
  for (const email of CLIENT_EMAILS) {
    const cookie = await mintSession(email);
    const me = await send(cookie, "GET", "/api/client/me");
    const profile = (me.json?.data ?? {}) as {
      id?: string;
      logsOpenFrom?: string | null;
      timezone?: string;
    };
    if (!profile.id) continue;
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: profile.timezone ?? "UTC",
    });
    const openFrom = profile.logsOpenFrom ?? null;
    seen.push({ email, clientId: profile.id, openFrom, today });
    if (openFrom === null || openFrom <= today) {
      const other = seen.find((s) => s.clientId !== profile.id)?.clientId;
      return {
        subject: { cookie, clientId: profile.id, email, today, openFrom },
        otherClientId:
          other ?? (await otherClientIdFor(profile.id)),
      };
    }
  }
  throw new Error(
    `no DEV client can log today: ${JSON.stringify(seen)}`
  );
}

/** Any other client of the same coach — the ownership gate's counterexample. */
async function otherClientIdFor(clientId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id")
    .neq("id", clientId)
    .limit(1)
    .single();
  if (!data) throw new Error("no second client on DEV");
  return data.id;
}

async function main() {
  const { subject, otherClientId } = await findSubject();
  const { cookie, clientId, today, openFrom } = subject;
  console.info(
    `\n${subject.email} · client ${clientId} · today ${today} · logsOpenFrom ${openFrom ?? "(no bound)"}\n`
  );
  // An open day: today is always inside the window the client may log.
  const openDay = today;
  // A locked day: before the boundary. With no boundary the client can log any
  // past day, so the locked case is the FUTURE, which is always refused.
  const lockedDay = openFrom
    ? new Date(new Date(`${openFrom}T00:00:00Z`).getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10)
    : new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000)
        .toISOString()
        .slice(0, 10);

  const open = await seedLoggedWorkout(clientId, openDay, "Clear-log proof — open day");
  const locked = await seedLoggedWorkout(clientId, lockedDay, "Clear-log proof — locked day");
  const foreign = await seedLoggedWorkout(
    otherClientId,
    openDay,
    "Clear-log proof — another client"
  );

  try {
    console.info("1  a save that records nothing is refused");
    const refused = await send(
      cookie,
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
      cookie,
      "POST",
      `/api/client/training/events/${open.eventId}/log`,
      { completionQuality: "skipped" }
    );
    check("400", skipped.status === 400, skipped.status);

    console.info("\n2  clear takes the log, its exercise rows and its sets");
    const cleared = await send(
      cookie,
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
      cookie,
      "DELETE",
      `/api/client/training/events/${open.eventId}/log`
    );
    check("200", again.status === 200, again);
    check("cleared: false", (again.json?.data as { cleared?: boolean })?.cleared === false, again.json);

    console.info("\n4  another client's workout is not found");
    const stranger = await send(
      cookie,
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
      cookie,
      "DELETE",
      "/api/client/training/events/not-a-uuid/log"
    );
    check(
      "answers 404 or 500, never a database sentence",
      (malformed.status === 404 || malformed.status === 500) &&
        !String(malformed.json?.error ?? "").includes("invalid input syntax"),
      malformed
    );

    console.info("\n5  a day outside the open window is locked");
    const lockedReply = await send(
      cookie,
      "DELETE",
      `/api/client/training/events/${locked.eventId}/log`
    );
    check("403", lockedReply.status === 403, lockedReply);
    check("This day is locked.", lockedReply.json?.error === "This day is locked.", lockedReply.json);
    check(
      "the log survives",
      (await countRows("session_logs", "id", locked.logId)) === 1
    );
  } finally {
    await supabaseAdmin
      .from("session_logs")
      .delete()
      .in("id", [open.logId, locked.logId, foreign.logId]);
    await supabaseAdmin
      .from("training_events")
      .delete()
      .in("id", [open.eventId, locked.eventId, foreign.eventId]);
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
