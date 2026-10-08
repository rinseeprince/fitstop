/**
 * Request-level proof of migration 200 (docs/DATA-ACCESS-LOCKDOWN-PLAN.md §6
 * commit 2): the Data API's write side door, before the push and after it,
 * against the linked DEV database through a next dev the script starts on a
 * free port.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/data-api-writes-proof.ts before
 *   npx tsx --tsconfig ./tsconfig.json scripts/data-api-writes-proof.ts after
 *
 * The side door is `/rest/v1` called with the project's public key (read
 * through the CLI, scripts/data-api-key.ts) and the user's own login token:
 * no route, so none of the routes' rules. A throwaway client with its own
 * login (scripts/auth-fixtures.ts: the invite) and a habit is made under the
 * owner's coach, and everything is removed at the end: its audit rows, the
 * client (its logs, habit, check-ins, reading and invitation cascade) and the
 * login with its profile. Every fixture number is distinct.
 *
 *   1  the client, through the side door: inserts wellness and a habit entry
 *      on one day, wellness and a food log on another, and a check-in;
 *      rewrites a seeded day's wellness, food log and habit entry
 *   2  the coach, through the side door: inserts a check-in for the client,
 *      then deletes the client
 *   3  the app still writes, through the server: the coach activates the
 *      pending client; the client saves wellness and ticks the habit, through
 *      its entry route
 *   4  the catalog: 56 write rules in public before the push; after it, and
 *      since migration 201 took the last one (activation's) with every other
 *      policy, none
 *
 * Every attempt in 1 and 2 is made twice. With the user's login token, which
 * is Better Auth's session token and never a JWT, PostgREST refuses it before
 * choosing any role — 401, PGRST301: what a signed-in browser holds writes
 * nothing through the side door. With the public key alone it reaches Postgres
 * as the anon role, which the lock refuses — 401, 42501. Nothing is written
 * either way, read back with the service role. The authenticated role's own
 * lock is `npm run check:rls` clause 5's. These are the expectations after the
 * push; 3 holds in both modes.
 */
import "./env-bootstrap";

import { execFileSync } from "node:child_process";
import { createThrowawayLogin, deleteThrowawayLogin, loginIdFor } from "./auth-fixtures";
import { supabaseAdmin } from "@/services/supabase-admin";
import { appendMeasurements } from "@/services/measurements-service";
import { addHabits } from "@/services/client-habit-writes-service";
import { getClientTodayString } from "@/services/today-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import { dataApiPublicKey } from "./data-api-key";
import { endMintedSessions, mintSession, send, type ProofSession } from "./proof-session";
import { startProofServer, stopProofServer } from "./proof-server";

const COACH_EMAIL = "samuel.k@taboola.com";
const ACTIVATION_RULE = "Coaches can update their own clients on clients (UPDATE)";

const mode = process.argv[2];
if (mode !== "before" && mode !== "after") {
  console.error("Usage: npx tsx scripts/data-api-writes-proof.ts before|after");
  process.exit(2);
}
// Before the push 56 write rules stood; now none: migration 201 took the last, activation's.
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
const PUBLIC_KEY = dataApiPublicKey();

type SideDoorReply = { status: number; code: string | null };

/** One write through the side door: the public key, and the user's own token or nothing else. */
async function sideDoor(
  caller: ProofSession | "public key",
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<SideDoorReply> {
  const res = await fetch(`${REST_URL}/${path}`, {
    method,
    headers: {
      apikey: PUBLIC_KEY,
      Authorization: caller === "public key" ? `Bearer ${PUBLIC_KEY}` : caller.headers.Authorization,
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

// PostgREST's answer to a bearer token it cannot read as a JWT: no role was chosen.
const unreadable = (reply: SideDoorReply) => reply.status === 401 && reply.code === "PGRST301";
// Postgres's answer to the anon role, which holds no privilege in public (migration 201).
const locked = (reply: SideDoorReply) => reply.status === 401 && reply.code === "42501";

type BothWays = { token: SideDoorReply; publicKey: SideDoorReply };

/** One write tried both ways: with the user's login token, then with the public key alone. */
async function bothWays(session: ProofSession, method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<BothWays> {
  return { token: await sideDoor(session, method, path, body), publicKey: await sideDoor("public key", method, path, body) };
}

/** An insert: the token refused unread, the public key refused by the lock, nothing written. */
function insertCheck(label: string, replies: BothWays, written: boolean): void {
  check(
    `${label} → the token refused unread (401, PGRST301), the public key refused (401, 42501), nothing written`,
    unreadable(replies.token) && locked(replies.publicKey) && !written,
    { replies, written }
  );
}

/** An update or a delete: the token refused unread, the public key refused by the lock, the row as it was. */
function changeCheck(label: string, replies: BothWays, changed: boolean, intact: boolean): void {
  check(
    `${label} → the token refused unread (401, PGRST301), the public key refused (401, 42501), unchanged`,
    unreadable(replies.token) && locked(replies.publicKey) && !changed && intact,
    { replies, changed, intact }
  );
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

/**
 * Activation needs a weight reading; the habit tick needs a habit, running on
 * every day the proof writes an entry on — added from `habitStart`, which the
 * function is handed as its today (it refuses a start before the today it is
 * given), through add_client_habits, the only way a habit is written.
 */
async function giveWeightAndHabit(clientId: string, coachId: string, today: string, habitStart: string): Promise<string> {
  await appendMeasurements({ clientId, source: "intake", recordedOn: today, values: { weight: 76.4 } });
  const [habitId] = await addHabits({
    clientId,
    today: habitStart,
    startsOn: habitStart,
    createdBy: coachId,
    habits: [
      {
        name: "Data API proof habit",
        howTo: null,
        measure: "tick",
        unit: null,
        direction: null,
        target: null,
        schedule: { weekdays: [...DAYS_OF_WEEK] },
      },
    ],
  });
  return habitId;
}

async function countOf(table: "wellness_logs" | "check_ins" | "client_habits", clientId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  console.info(`Mode: ${mode} the push — ${OPEN ? "56 write rules" : "no write rule"} in public; a login's token opens the side door in neither.`);
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
    await startProofServer();
    console.info("Setup: a pending client with its own login, a weight reading, a habit and two seeded days");
    const A = await makeClient(coach.id, email, null);
    clientId = A;
    ({ userId } = await createThrowawayLogin({
      role: "client",
      email,
      password: `Proof-${stamp}-${Math.random().toString(36).slice(2)}`,
      clientId: A,
    }));

    const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("user_id", userId).maybeSingle();
    const { count: coachRows } = await supabaseAdmin
      .from("coaches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    check("setup: the login is a client, with no coach row", profile?.role === "client" && coachRows === 0, { profile, coachRows });

    const T = await getClientTodayString(A);
    const day = (n: number) => addDaysToDateString(T, n);
    const D1 = day(-3); // the side door's own day: wellness and a habit entry
    const D2 = day(-4); // a seeded day the side door rewrites
    const D3 = day(-5); // a day the side door writes wellness and food on
    const START = day(-6); // the start date activation sends, and the habit's first day
    let H = await giveWeightAndHabit(A, coach.id, T, START);

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
      supabaseAdmin
        .from("client_habit_logs")
        .insert({ client_habit_id: H, client_id: A, date: D2, done: false })
        .select("id")
        .single(),
      "habit entry"
    );

    const client = await mintSession(email, "client");
    const coachSession = await mintSession(COACH_EMAIL, "coach");

    console.info(`1. The client, through the side door (${mode} the push)`);
    const wellnessD1 = await bothWays(client,"POST", "wellness_logs", { client_id: A, date: D1, mood: 5, energy: 7 });
    const { data: wellnessD1Row } = await supabaseAdmin.from("wellness_logs").select("mood, energy").eq("client_id", A).eq("date", D1).maybeSingle();
    insertCheck("wellness on a day", wellnessD1, wellnessD1Row?.mood === 5 && wellnessD1Row.energy === 7);

    const wellness = await bothWays(client,"POST", "wellness_logs", { client_id: A, date: D3, mood: 2, energy: 9 });
    const { data: wellnessRow } = await supabaseAdmin.from("wellness_logs").select("mood, energy").eq("client_id", A).eq("date", D3).maybeSingle();
    insertCheck("wellness on another day", wellness, wellnessRow?.mood === 2 && wellnessRow.energy === 9);

    const food = await bothWays(client,"POST", "nutrition_logs", {
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

    const habitEntry = await bothWays(client,"POST", "client_habit_logs", { client_habit_id: H, client_id: A, date: D1, done: true });
    const { data: habitEntryRow } = await supabaseAdmin
      .from("client_habit_logs")
      .select("done")
      .eq("client_habit_id", H)
      .eq("date", D1)
      .maybeSingle();
    insertCheck("a habit entry", habitEntry, habitEntryRow?.done === true);

    const clientCheckIn = await bothWays(client,"POST", "check_ins", { client_id: A, notes: "side-door check-in from the client" });
    const { count: clientCheckIns } = await supabaseAdmin
      .from("check_ins")
      .select("id", { count: "exact", head: true })
      .eq("client_id", A)
      .eq("notes", "side-door check-in from the client");
    insertCheck("a check-in", clientCheckIn, clientCheckIns === 1);

    const rewriteWellness = await bothWays(client,"PATCH", `wellness_logs?id=eq.${W2}`, { mood: 4 });
    const { data: wellnessAfter } = await supabaseAdmin.from("wellness_logs").select("mood").eq("id", W2).maybeSingle();
    changeCheck("its wellness", rewriteWellness, wellnessAfter?.mood === 4, wellnessAfter?.mood === 1);

    const rewriteFood = await bothWays(client,"PATCH", `nutrition_logs?id=eq.${N2}`, { calories_consumed: 3120 });
    const { data: foodAfter } = await supabaseAdmin.from("nutrition_logs").select("calories_consumed").eq("id", N2).maybeSingle();
    changeCheck("its food log", rewriteFood, foodAfter?.calories_consumed === 3120, foodAfter?.calories_consumed === 1810);

    const rewriteHabit = await bothWays(client,"PATCH", `client_habit_logs?id=eq.${HL2}`, { done: true });
    const { data: habitAfter } = await supabaseAdmin.from("client_habit_logs").select("done").eq("id", HL2).maybeSingle();
    changeCheck("its habit entry", rewriteHabit, habitAfter?.done === true, habitAfter?.done === false);

    console.info(`2. The coach, through the side door (${mode} the push)`);
    const coachCheckIn = await bothWays(coachSession,"POST", "check_ins", { client_id: A, notes: "side-door check-in from the coach" });
    const { count: coachCheckIns } = await supabaseAdmin
      .from("check_ins")
      .select("id", { count: "exact", head: true })
      .eq("client_id", A)
      .eq("notes", "side-door check-in from the coach");
    insertCheck("a check-in for the client", coachCheckIn, coachCheckIns === 1);

    const logsBefore = await countOf("wellness_logs", A);
    const deleted = await bothWays(coachSession,"DELETE", `clients?id=eq.${A}`);
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
      H = await giveWeightAndHabit(A, coach.id, T, START);
      check("the proof recreates the client", (await countOf("client_habits", A)) === 1);
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

    const ticked = await send(client, "PUT", `/api/client/habits/${H}/days/${T}`, { done: true });
    const { data: tickRow } = await supabaseAdmin
      .from("client_habit_logs")
      .select("done")
      .eq("client_habit_id", H)
      .eq("date", T)
      .maybeSingle();
    check("the client ticks the habit → 200, on the day", ticked.status === 200 && tickRow?.done === true, {
      status: ticked.status,
      tickRow,
    });

    console.info("4. The catalog");
    const rules = writeRulesInPublic();
    if (OPEN) {
      check("56 write rules in public, activation's among them", rules.length === 56 && rules.includes(ACTIVATION_RULE), rules.length);
    } else {
      check("no write rule left in public: migration 201 took the last, activation's, with every other policy", rules.length === 0, rules);
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
    try {
      await deleteThrowawayLogin(email);
    } catch (error) {
      console.error(`  login not deleted: ${error instanceof Error ? error.message : String(error)}`);
    }
    await endMintedSessions();
    if (clientId) {
      const left = (await countOf("wellness_logs", clientId)) + (await countOf("check_ins", clientId)) + (await countOf("client_habits", clientId));
      const { data: clientLeft } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
      check("cleanup: the client is gone, and its logs, check-ins and habit with it", clientLeft === null && left === 0, { clientLeft, left });
    }
    if (userId) {
      const { data: profileLeft } = await supabaseAdmin.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
      const loginLeft = await loginIdFor(email);
      check("cleanup: the login and its profile are gone", profileLeft === null && loginLeft === null, { profileLeft, loginLeft });
    }
    await stopProofServer();
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
