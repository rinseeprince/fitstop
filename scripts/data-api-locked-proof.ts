/**
 * Request-level proof of migration 201 (docs/DATA-ACCESS-LOCKDOWN-PLAN.md §6
 * commit 6): the Data API is locked, before the push and after it, against the
 * linked DEV database.
 *
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/data-api-locked-proof.ts before
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/data-api-locked-proof.ts after
 *
 * Three callers, none of them the server: the browser's public key alone, a
 * real client's token and a real coach's token — a browser holding the login
 * could send any of them to `/rest/v1` directly, skipping every route. For
 * every table and view in `public` (the live list, read from the catalog) each
 * caller asks `GET /rest/v1/<relation>?select=*&limit=1`. The whole matrix is
 * written to WIRE_PROOF_DIR/data-api-locked/<mode>.json, outside the tree.
 *
 *   before  the door is open: PostgREST answers 200 wherever the role holds a
 *           grant — the rows the policies allow, or none — so the client reads
 *           their own client row and the coach their own coach row through the
 *           sign-in rules migration 137 labelled; only the seven tables made
 *           closed under CONVENTIONS §8's new-table rule refuse the tokens, and
 *           the public key is refused on those plus the four authenticated-only
 *           relations (migration 158). A policy that is slow to evaluate can
 *           run into the role's statement timeout (57014) — the door open, and
 *           the query running, not a refusal
 *   after   every relation refuses every caller: 401 for the public key and
 *           403 for a token, both with Postgres's 42501 (permission denied),
 *           because anon and authenticated hold no privilege in public
 *
 * The two logins are throwaways made for the run and removed at the end, under
 * the owner's coach: a client — an invitation row first, so the signup trigger
 * gives the login the client role — and a coach, whose login the trigger gives
 * a coaches row. In both modes the proof reads those two roles back, which
 * after the push shows `handle_new_user()` still fires once its EXECUTE grant
 * is service_role's and supabase_auth_admin's alone. The catalog counts are
 * read too: 53 policies and 88 public-role grants (a relation and a grantee)
 * before, 0 and 0 after.
 * When a `next dev` answers at WIRE_PROOF_BASE, the app's own doors are tried
 * as well — the client's `/api/client/me`, the coach's `/api/clients` — and
 * must answer 200 in both modes: the lock changes nothing the app does.
 */
import "./env-bootstrap";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/services/supabase-admin";
import { mintSession, send, PROOF_BASE, type ProofSession } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";
// Made closed at creation (REVOKE, then GRANT service_role): a token was
// already refused on them before the push.
const CLOSED_BEFORE = new Set([
  "client_goal_deadlines",
  "client_goals",
  "coach_saved_exercise_groups",
  "nutrition_day_edits",
  "nutrition_plan_kept_goals",
  "session_log_group_scores",
  "training_exercise_groups",
]);
// authenticated SELECT only (migration 158): the public key was already refused.
const AUTHENTICATED_ONLY_BEFORE = new Set([
  "client_measurements",
  "client_measurements_live",
  "client_current_measurements",
  "client_baseline_measurements",
]);

const mode = process.argv[2];
if (mode !== "before" && mode !== "after") {
  console.error("Usage: WIRE_PROOF_DIR=<dir> npx tsx scripts/data-api-locked-proof.ts before|after");
  process.exit(2);
}
const OPEN = mode === "before";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 800));
  }
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}
const REST_URL = `${need("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1`;
const ANON_KEY = need("NEXT_PUBLIC_SUPABASE_ANON_KEY");

function proofDir(): string {
  const root = process.env.WIRE_PROOF_DIR;
  if (!root) throw new Error("Set WIRE_PROOF_DIR to a folder outside the tree (the scratchpad)");
  const dir = join(root, "data-api-locked");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** One catalog query through the CLI's password-free login (PostgREST cannot reach pg_catalog). */
function catalog<T>(sql: string): T[] {
  const out = execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { rows: T[] };
  return parsed.rows;
}

type Relation = { relname: string; relkind: string };
function relationsInPublic(): Relation[] {
  return catalog<Relation>(
    "SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m') ORDER BY c.relkind, c.relname",
  );
}

type Counts = { policies: number; grants: number };
function catalogCounts(): Counts {
  const [row] = catalog<{ policies: string; grants: string }>(
    "SELECT (SELECT count(*) FROM pg_policies WHERE schemaname IN ('public','storage')) AS policies, " +
      "(SELECT count(DISTINCT (c.oid, a.grantee)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a " +
      "WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated'))) AS grants",
  );
  return { policies: Number(row.policies), grants: Number(row.grants) };
}

type Cell = { status: number; code: string | null; rows: number | null };

/** One read straight at the Data API: the public key, and a token when the caller has one. */
async function sideDoor(token: string | null, relation: string): Promise<Cell> {
  const res = await fetch(`${REST_URL}/${relation}?select=*&limit=1`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token ?? ANON_KEY}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let code: string | null = null;
  let rows: number | null = null;
  try {
    const json = JSON.parse(text) as unknown;
    if (Array.isArray(json)) rows = json.length;
    else code = (json as { code?: string }).code ?? null;
  } catch {
    code = null;
  }
  return { status: res.status, code, rows };
}

const refused = (cell: Cell, withToken: boolean) => cell.status === (withToken ? 403 : 401) && cell.code === "42501";
const answered = (cell: Cell) => cell.status === 200 && cell.rows !== null;
// The role's statement timeout while a policy's nested subqueries run: the
// query was allowed to start, so the door is open. Only possible before.
const timedOut = (cell: Cell) => cell.status === 500 && cell.code === "57014";

async function appAnswers(path: string, session: ProofSession): Promise<number | null> {
  try {
    const res = await send(session, "GET", path);
    return res.status;
  } catch {
    return null;
  }
}

async function devServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${PROOF_BASE}/login`, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.info(`Mode: ${mode} the push — the Data API should be ${OPEN ? "open" : "locked"}.`);
  const { data: coach, error: coachError } = await supabaseAdmin.from("coaches").select("id").eq("email", COACH_EMAIL).single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const stamp = Date.now();
  const clientEmail = `data-api-locked-client-${stamp}@fixture.local`;
  const coachEmail = `data-api-locked-coach-${stamp}@fixture.local`;
  let clientId: string | null = null;
  let clientUserId: string | null = null;
  let coachUserId: string | null = null;

  try {
    console.info("Setup: a client with its own login under the owner's coach, and a coach with its own login");
    const { data: made, error: clientError } = await supabaseAdmin
      .from("clients")
      .insert({
        coach_id: coach.id,
        name: "Data API locked proof",
        email: clientEmail,
        active: true,
        onboarding_status: "active",
        timezone: "Europe/London",
      })
      .select("id")
      .single();
    if (clientError || !made) throw new Error(`client insert: ${clientError?.message}`);
    clientId = made.id;
    const { error: inviteError } = await supabaseAdmin
      .from("client_invitations")
      .insert({ client_id: clientId, email: clientEmail, status: "accepted" });
    if (inviteError) throw new Error(`invitation insert: ${inviteError.message}`);

    const password = () => `Proof-${stamp}-${Math.random().toString(36).slice(2)}`;
    const { data: clientUser, error: clientUserError } = await supabaseAdmin.auth.admin.createUser({
      email: clientEmail,
      email_confirm: true,
      password: password(),
    });
    if (clientUserError || !clientUser.user) throw new Error(`createUser (client): ${clientUserError?.message}`);
    clientUserId = clientUser.user.id;
    const { error: linkError } = await supabaseAdmin.from("clients").update({ user_id: clientUserId }).eq("id", clientId);
    if (linkError) throw new Error(`client link: ${linkError.message}`);

    const { data: coachUser, error: coachUserError } = await supabaseAdmin.auth.admin.createUser({
      email: coachEmail,
      email_confirm: true,
      password: password(),
    });
    if (coachUserError || !coachUser.user) throw new Error(`createUser (coach): ${coachUserError?.message}`);
    coachUserId = coachUser.user.id;

    // The signup trigger, handle_new_user(), decided both roles.
    const { data: clientProfile } = await supabaseAdmin.from("profiles").select("role").eq("user_id", clientUserId).maybeSingle();
    const { data: coachProfile } = await supabaseAdmin.from("profiles").select("role").eq("user_id", coachUserId).maybeSingle();
    const { count: coachRows } = await supabaseAdmin.from("coaches").select("id", { count: "exact", head: true }).eq("user_id", coachUserId);
    check("the signup trigger made the invited login a client", clientProfile?.role === "client", clientProfile);
    check("…and the uninvited login a trainer with a coaches row", coachProfile?.role === "trainer" && coachRows === 1, { coachProfile, coachRows });

    const clientSession = await mintSession(clientEmail, "client");
    const coachSession = await mintSession(coachEmail, "coach");

    const relations = relationsInPublic();
    check(`the live catalog lists the public relations (${relations.length})`, relations.length > 40, relations.length);

    console.info(`1. Every table and view in public, through the Data API (${mode} the push)`);
    const callers: Array<{ label: string; token: string | null }> = [
      { label: "public key", token: null },
      { label: "client token", token: clientSession.accessToken },
      { label: "coach token", token: coachSession.accessToken },
    ];
    const matrix: Record<string, Record<string, Cell>> = {};
    for (const caller of callers) {
      matrix[caller.label] = {};
      for (const relation of relations) {
        matrix[caller.label][relation.relname] = await sideDoor(caller.token, relation.relname);
      }
    }
    writeFileSync(join(proofDir(), `${mode}.json`), JSON.stringify({ mode, at: new Date().toISOString(), relations, matrix }, null, 2));

    for (const caller of callers) {
      const cells = matrix[caller.label];
      const withToken = caller.token !== null;
      const refusedNames = Object.entries(cells).filter(([, c]) => refused(c, withToken)).map(([n]) => n);
      const answeredNames = Object.entries(cells).filter(([, c]) => answered(c)).map(([n]) => n);
      const timedOutNames = Object.entries(cells).filter(([, c]) => timedOut(c)).map(([n]) => n);
      const other = Object.entries(cells).filter(([, c]) => !refused(c, withToken) && !answered(c) && !timedOut(c));
      if (OPEN) {
        const expectedRefused = new Set([...CLOSED_BEFORE, ...(withToken ? [] : AUTHENTICATED_ONLY_BEFORE)]);
        const wrong = Object.keys(cells).filter((n) => expectedRefused.has(n) !== refusedNames.includes(n));
        const slow = timedOutNames.length === 0 ? "" : `, ${timedOutNames.length} still running at the role's timeout (${timedOutNames.join(", ")})`;
        check(
          `${caller.label}: open — ${answeredNames.length} relations answer${slow}, ${refusedNames.length} refuse (the ones made closed at creation)`,
          wrong.length === 0 && other.length === 0,
          { wrong, other },
        );
      } else {
        check(
          `${caller.label}: refused on every one of ${relations.length} relations (${withToken ? 403 : 401}, 42501)`,
          refusedNames.length === relations.length && other.length === 0 && timedOutNames.length === 0,
          { answered: answeredNames, timedOut: timedOutNames, other },
        );
      }
    }
    if (OPEN) {
      check(
        "the client token reads their own client row through the sign-in rule",
        matrix["client token"].clients.rows === 1,
        matrix["client token"].clients,
      );
      check("the coach token reads their own coach row through the sign-in rule", matrix["coach token"].coaches.rows === 1, matrix["coach token"].coaches);
      check("the public key reads nothing from a policy table, yet is answered", matrix["public key"].clients.rows === 0, matrix["public key"].clients);
    }

    console.info("2. The catalog");
    const counts = catalogCounts();
    if (OPEN) {
      check("policies before: 53 (47 in public, 6 on storage.objects); public-role grants: 88", counts.policies === 53 && counts.grants === 88, counts);
    } else {
      check("no policy in public or storage, and no anon/authenticated privilege on a public relation", counts.policies === 0 && counts.grants === 0, counts);
    }

    console.info("3. The app's own doors");
    if (await devServerUp()) {
      const me = await appAnswers("/api/client/me", clientSession);
      const clients = await appAnswers("/api/clients", coachSession);
      check(`the client's /api/client/me answers 200 through the server (${PROOF_BASE})`, me === 200, me);
      check("the coach's /api/clients answers 200 through the server", clients === 200, clients);
    } else {
      console.info(`  – no dev server at ${PROOF_BASE}; the app's doors are covered by the browser smoke`);
    }
  } finally {
    console.info("Cleanup");
    if (clientId) {
      const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().eq("client_id", clientId);
      if (auditError) console.error(`  audit rows not deleted: ${auditError.message}`);
      const { error: clientError } = await supabaseAdmin.from("clients").delete().eq("id", clientId);
      if (clientError) console.error(`  client not deleted: ${clientError.message}`);
    }
    if (coachUserId) {
      const { error: coachRowError } = await supabaseAdmin.from("coaches").delete().eq("user_id", coachUserId);
      if (coachRowError) console.error(`  coach row not deleted: ${coachRowError.message}`);
    }
    for (const id of [clientUserId, coachUserId]) {
      if (!id) continue;
      const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (error) console.error(`  login ${id} not deleted: ${error.message}`);
    }
    if (clientId) {
      const { data: clientLeft } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
      check("cleanup: the client is gone", clientLeft === null, clientLeft);
    }
    for (const id of [clientUserId, coachUserId]) {
      if (!id) continue;
      const { data: profileLeft } = await supabaseAdmin.from("profiles").select("user_id").eq("user_id", id).maybeSingle();
      const { count: coachLeft } = await supabaseAdmin.from("coaches").select("id", { count: "exact", head: true }).eq("user_id", id);
      const { data: userLeft } = await supabaseAdmin.auth.admin.getUserById(id);
      check(`cleanup: login ${id.slice(0, 8)}… and its rows are gone`, profileLeft === null && coachLeft === 0 && !userLeft?.user, { profileLeft, coachLeft });
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
