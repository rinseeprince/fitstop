/**
 * Request-level proof of migration 200 (docs/DATA-ACCESS-LOCKDOWN-PLAN.md §6
 * commit 2): the Data API's write side door, before the push and after it,
 * against the linked DEV database through a running `next dev`.
 *
 *   npx tsx scripts/data-api-writes-proof.ts before   # every side-door attempt succeeds
 *   npx tsx scripts/data-api-writes-proof.ts after    # every side-door attempt is refused
 *
 * The side door is `/rest/v1` called with the browser's public key and the
 * user's own token: no route, so none of the routes' rules. A throwaway client
 * with its own login and a habit is made under the owner's coach — an
 * invitation row first, so the signup trigger gives the login the client role —
 * and everything is removed at the end: its audit rows, the client (its logs,
 * habit, check-ins, reading and invitation cascade) and the login (its profile
 * cascades). Every fixture number is distinct.
 *
 *   1  the client, through the side door: inserts wellness and a habit log on
 *      one day, wellness and a food log on another, and a check-in; rewrites a
 *      seeded day's wellness, food log and habit log
 *   2  the coach, through the side door: inserts a check-in for the client,
 *      then deletes the client — before the push it is gone, and the proof
 *      recreates it
 *   3  the app still writes: the coach activates the pending client, through
 *      the one write rule kept; the client saves wellness and ticks the habit
 *   4  the catalog: 56 write rules in public before the push, one after it —
 *      activation's
 *
 * Before the push every attempt in 1 and 2 succeeds. After it an insert is
 * refused with the RLS error, and an update or a delete changes nothing, read
 * back with the service role. 3 holds in both.
 */
import "./env-bootstrap";

import { execFileSync } from "node:child_process";
import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { getClientTodayString } from "@/services/today-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import { mintSession, send, type ProofSession } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";
const ACTIVATION_RULE = "Coaches can update their own clients on clients (UPDATE)";

const mode = process.argv[2];
if (mode !== "before" && mode !== "after") {
  console.error("Usage: npx tsx scripts/data-api-writes-proof.ts before|after");
  process.exit(2);
}
// Before the push the side door is open; after it, closed.
const OPEN = mode === "before";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}
const REST_URL = `${need("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1`;
const ANON_KEY = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");

type SideDoorReply = { status: number; code: string | null };

/** One write through the side door: the public key and the user's own token. */
async function sideDoor(
  session: ProofSession,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<SideDoorReply> {
  const res = await fetch(`${REST_URL}/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let code: string | null = null;
  try {
    code = (JSON.parse(text) as { code?: string }).code ?? null;
  } catch {
    code = null;
  }
  return { status: res.status, code };
}

/** An insert: written before the push; refused by RLS (403, 42501) after it, with nothing written. */
function insertCheck(label: string, reply: SideDoorReply, written: boolean): void {
  if (OPEN) check(`${label} → 201, written`, reply.status === 201 && written, { reply, written });
  else check(`${label} → refused (403, 42501), nothing written`, reply.status === 403 && reply.code === "42501" && !written, { reply, written });
}

/** An update or a delete: it lands before the push; after it the row is as it was. */
function changeCheck(label: string, reply: SideDoorReply, changed: boolean, intact: boolean): void {
  const answered = reply.status >= 200 && reply.status < 300;
  if (OPEN) check(`${label} → ${reply.status}, changed`, answered && changed, { reply, changed });
  else check(`${label} → ${reply.status}, unchanged`, answered && intact, { reply, intact });
}

/** The write rules in public, read from the catalog (PostgREST cannot reach pg_policies). */
function writeRulesInPublic(): string[] {
  const out = execFileSync(
    "npx",
    [
      "supabase",
      "db",
      "query",
      "--linked",
      "SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND cmd <> 'SELECT' ORDER BY tablename, policyname",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as {
    rows: Array<{ tablename: string; policyname: string; cmd: string }>;
  };
  return parsed.rows.map((r) => `${r.policyname} on ${r.tablename} (${r.cmd})`);
}

async function makeClient(coachId: string, email: string, userId: string | null, id?: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      ...(id ? { id } : {}),
      coach_id: coachId,
      name: "Data API proof",
      email,
      active: true,
      onboarding_status: "setup_in_progress",
      timezone: "Europe/London",
      user_id: userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`client insert: ${error?.message}`);
  return data.id;
}

/** Activation needs a weight reading; the habit tick needs a habit. */
async function giveWeightAndHabit(clientId: string, coachId: string, today: string): Promise<string> {
  await appendMeasurements({ clientId, source: "intake", recordedOn: today, values: { weight: 76.4 } });
  const { data, error } = await supabaseAdmin
    .from("daily_habits")
    .insert({ coach_id: coachId, client_id: clientId, name: "Data API proof habit", is_boolean: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`habit insert: ${error?.message}`);
  return data.id;
}

async function countOf(table: "wellness_logs" | "check_ins" | "daily_habits", clientId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  console.info(`Mode: ${mode} the push — the side door should be ${OPEN ? "open" : "closed"}.`);
  const { data: coach, error: coachError } = await supabaseAdmin
    .from("coaches")
    .select("id")
    .eq("email", COACH_EMAIL)
    .single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const stamp = Date.now();
  const email = `data-api-proof-${stamp}@fixture.local`;
  let clientId: string | null = null;
  let userId: string | null = null;

  try {
    console.info("Setup: a pending client with its own login, a weight reading, a habit and two seeded days");
    const A = await makeClient(coach.id, email, null);
    clientId = A;
    const { error: inviteError } = await supabaseAdmin
      .from("client_invitations")
      .insert({ client_id: A, email, status: "accepted" });
    if (inviteError) throw new Error(`invitation insert: ${inviteError.message}`);
    const { data: created, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: `Proof-${stamp}-${Math.random().toString(36).slice(2)}`,
    });
    if (userError || !created.user) throw new Error(`createUser: ${userError?.message}`);
    userId = created.user.id;
    const { error: linkError } = await supabaseAdmin.from("clients").update({ user_id: userId }).eq("id", A);
    if (linkError) throw new Error(`client link: ${linkError.message}`);

    const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("user_id", userId).maybeSingle();
    const { count: coachRows } = await supabaseAdmin
      .from("coaches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    check("setup: the login is a client, with no coach row", profile?.role === "client" && coachRows === 0, { profile, coachRows });

    const T = await getClientTodayString(A);
    const day = (n: number) => addDaysToDateString(T, n);
    const D1 = day(-3); // the side door's own day: wellness and a habit log
    const D2 = day(-4); // a seeded day the side door rewrites
    const D3 = day(-5); // a day the side door writes wellness and food on
    const START = day(-6); // the start date activation sends
    let H = await giveWeightAndHabit(A, coach.id, T);

    const seeded = async <T extends { id: string }>(
      query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
      what: string
    ) => {
      const { data, error } = await query;
      if (error || !data) throw new Error(`${what} seed: ${error?.message}`);
      return data.id;
    };
    const W2 = await seeded(
      supabaseAdmin.from("wellness_logs").insert({ client_id: A, date: D2, mood: 1, energy: 6 }).select("id").single(),
      "wellness"
    );
    const N2 = await seeded(
      supabaseAdmin
        .from("nutrition_logs")
        .insert({ client_id: A, date: D2, calories_consumed: 1810, protein_g: 122 })
        .select("id")
        .single(),
      "food log"
    );
    const HL2 = await seeded(
      supabaseAdmin.from("daily_habit_logs").insert({ daily_habit_id: H, client_id: A, date: D2, completed: false }).select("id").single(),
      "habit log"
    );

    const client = await mintSession(email, "client");
    const coachSession = await mintSession(COACH_EMAIL, "coach");

    console.info(`1. The client, through the side door (${mode} the push)`);
    const wellnessD1 = await sideDoor(client, "POST", "wellness_logs", { client_id: A, date: D1, mood: 5, energy: 7 });
    const { data: wellnessD1Row } = await supabaseAdmin.from("wellness_logs").select("mood, energy").eq("client_id", A).eq("date", D1).maybeSingle();
    insertCheck("wellness on a day", wellnessD1, wellnessD1Row?.mood === 5 && wellnessD1Row.energy === 7);

    const wellness = await sideDoor(client, "POST", "wellness_logs", { client_id: A, date: D3, mood: 2, energy: 9 });
    const { data: wellnessRow } = await supabaseAdmin.from("wellness_logs").select("mood, energy").eq("client_id", A).eq("date", D3).maybeSingle();
    insertCheck("wellness on another day", wellness, wellnessRow?.mood === 2 && wellnessRow.energy === 9);

    const food = await sideDoor(client, "POST", "nutrition_logs", {
      client_id: A,
      date: D3,
      calories_consumed: 2465,
      protein_g: 171,
    });
    const { data: foodRow } = await supabaseAdmin
      .from("nutrition_logs")
      .select("calories_consumed, protein_g")
      .eq("client_id", A)
      .eq("date", D3)
      .maybeSingle();
    insertCheck("a food log", food, foodRow?.calories_consumed === 2465 && foodRow.protein_g === 171);

    const habitLog = await sideDoor(client, "POST", "daily_habit_logs", { daily_habit_id: H, client_id: A, date: D1, completed: true });
    const { data: habitLogRow } = await supabaseAdmin
      .from("daily_habit_logs")
      .select("completed")
      .eq("daily_habit_id", H)
      .eq("date", D1)
      .maybeSingle();
    insertCheck("a habit log", habitLog, habitLogRow?.completed === true);

    const clientCheckIn = await sideDoor(client, "POST", "check_ins", { client_id: A, notes: "side-door check-in from the client" });
    const { count: clientCheckIns } = await supabaseAdmin
      .from("check_ins")
      .select("id", { count: "exact", head: true })
      .eq("client_id", A)
      .eq("notes", "side-door check-in from the client");
    insertCheck("a check-in", clientCheckIn, clientCheckIns === 1);

    const rewriteWellness = await sideDoor(client, "PATCH", `wellness_logs?id=eq.${W2}`, { mood: 4 });
    const { data: wellnessAfter } = await supabaseAdmin.from("wellness_logs").select("mood").eq("id", W2).maybeSingle();
    changeCheck("its wellness", rewriteWellness, wellnessAfter?.mood === 4, wellnessAfter?.mood === 1);

    const rewriteFood = await sideDoor(client, "PATCH", `nutrition_logs?id=eq.${N2}`, { calories_consumed: 3120 });
    const { data: foodAfter } = await supabaseAdmin.from("nutrition_logs").select("calories_consumed").eq("id", N2).maybeSingle();
    changeCheck("its food log", rewriteFood, foodAfter?.calories_consumed === 3120, foodAfter?.calories_consumed === 1810);

    const rewriteHabit = await sideDoor(client, "PATCH", `daily_habit_logs?id=eq.${HL2}`, { completed: true });
    const { data: habitAfter } = await supabaseAdmin.from("daily_habit_logs").select("completed").eq("id", HL2).maybeSingle();
    changeCheck("its habit log", rewriteHabit, habitAfter?.completed === true, habitAfter?.completed === false);

    console.info(`2. The coach, through the side door (${mode} the push)`);
    const coachCheckIn = await sideDoor(coachSession, "POST", "check_ins", { client_id: A, notes: "side-door check-in from the coach" });
    const { count: coachCheckIns } = await supabaseAdmin
      .from("check_ins")
      .select("id", { count: "exact", head: true })
      .eq("client_id", A)
      .eq("notes", "side-door check-in from the coach");
    insertCheck("a check-in for the client", coachCheckIn, coachCheckIns === 1);

    const logsBefore = await countOf("wellness_logs", A);
    const deleted = await sideDoor(coachSession, "DELETE", `clients?id=eq.${A}`);
    const { data: clientAfter } = await supabaseAdmin.from("clients").select("id").eq("id", A).maybeSingle();
    const logsAfter = await countOf("wellness_logs", A);
    changeCheck(
      `deleting the client (${logsBefore} wellness logs)`,
      deleted,
      clientAfter === null && logsAfter === 0,
      clientAfter?.id === A && logsAfter === logsBefore
    );
    if (clientAfter === null) {
      // Recreated under the same id and login, so the session and the auth
      // cache still resolve to it for the app's writes below.
      await makeClient(coach.id, email, userId, A);
      H = await giveWeightAndHabit(A, coach.id, T);
      check("the proof recreates the client", (await countOf("daily_habits", A)) === 1);
    }

    console.info("3. The app still writes");
    const activation = await send(coachSession, "POST", `/api/clients/${A}/activate`, {
      startDate: START,
      welcomeMessage: "Data API proof welcome",
    });
    const { data: activated } = await supabaseAdmin
      .from("clients")
      .select("onboarding_status, start_date, welcome_message")
      .eq("id", A)
      .maybeSingle();
    check(
      "the coach activates the pending client → 200: active, from the date sent, with the message",
      activation.status === 200 &&
        activated?.onboarding_status === "active" &&
        activated.start_date === START &&
        activated.welcome_message === "Data API proof welcome",
      { status: activation.status, body: activation.text.slice(0, 200), activated }
    );
    let audited = 0;
    for (let attempt = 0; attempt < 20 && audited === 0; attempt += 1) {
      const { count } = await supabaseAdmin
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("client_id", A)
        .eq("action", "client.activate");
      audited = count ?? 0;
      if (audited === 0) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    check("…audited as client.activate", audited === 1, audited);

    const saved = await send(client, "PATCH", `/api/client/daily-logs/${T}/wellness`, { mood: 3, energy: 8 });
    const { data: savedRow } = await supabaseAdmin
      .from("wellness_logs")
      .select("mood, energy")
      .eq("client_id", A)
      .eq("date", T)
      .maybeSingle();
    check("the client saves wellness → 200, on the day", saved.status === 200 && savedRow?.mood === 3 && savedRow.energy === 8, {
      status: saved.status,
      savedRow,
    });

    const ticked = await send(client, "POST", "/api/client/habits/log", { dailyHabitId: H, date: T, completed: true });
    const { data: tickRow } = await supabaseAdmin
      .from("daily_habit_logs")
      .select("completed")
      .eq("daily_habit_id", H)
      .eq("date", T)
      .maybeSingle();
    check("the client ticks the habit → 200, on the day", ticked.status === 200 && tickRow?.completed === true, {
      status: ticked.status,
      tickRow,
    });

    console.info("4. The catalog");
    const rules = writeRulesInPublic();
    if (OPEN) {
      check("56 write rules in public, activation's among them", rules.length === 56 && rules.includes(ACTIVATION_RULE), rules.length);
    } else {
      check("one write rule left in public — activation's", rules.length === 1 && rules[0] === ACTIVATION_RULE, rules);
    }
  } finally {
    console.info("Cleanup");
    // Every delete first, so a failed read below cannot leave a login behind.
    if (clientId) {
      const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().eq("client_id", clientId);
      if (auditError) console.error(`  audit rows not deleted: ${auditError.message}`);
      const { error: clientError } = await supabaseAdmin.from("clients").delete().eq("id", clientId);
      if (clientError) console.error(`  client not deleted: ${clientError.message}`);
    }
    if (userId) {
      const { error: userDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (userDeleteError) console.error(`  login not deleted: ${userDeleteError.message}`);
    }
    if (clientId) {
      const left = (await countOf("wellness_logs", clientId)) + (await countOf("check_ins", clientId)) + (await countOf("daily_habits", clientId));
      const { data: clientLeft } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
      check("cleanup: the client is gone, and its logs, check-ins and habit with it", clientLeft === null && left === 0, { clientLeft, left });
    }
    if (userId) {
      const { data: profileLeft } = await supabaseAdmin.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
      const { data: userLeft } = await supabaseAdmin.auth.admin.getUserById(userId);
      check("cleanup: the login and its profile are gone", profileLeft === null && !userLeft?.user, { profileLeft });
    }
  }

  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.info("Every check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
