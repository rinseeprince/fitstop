/**
 * Request-level proof of migration 201 (docs/DATA-ACCESS-LOCKDOWN-PLAN.md §6
 * commit 6): the Data API is locked, before the push and after it, against the
 * linked DEV database.
 *
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx --tsconfig ./tsconfig.json scripts/data-api-locked-proof.ts before
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx --tsconfig ./tsconfig.json scripts/data-api-locked-proof.ts after
 *
 * Three callers, none of them the server: the project's public key alone, a
 * real client's login token and a real coach's — a browser holding a login
 * could send any of them to `/rest/v1` directly, skipping every route. For
 * every table and view in `public` (the live list, read from the catalog) each
 * caller asks `GET /rest/v1/<relation>?select=*&limit=1`. The whole matrix is
 * written to WIRE_PROOF_DIR/data-api-locked/<mode>.json, outside the tree. The
 * public key is Supabase's anon key, read through the CLI
 * (scripts/data-api-key.ts): the app holds it no more, but every browser
 * bundle carried it until Better Auth.
 *
 *   before  the door is open to the public key: PostgREST answers 200
 *           wherever anon holds a grant — the rows the policies allow, or
 *           none; only the seven tables made closed under CONVENTIONS §8's
 *           new-table rule and the four authenticated-only relations
 *           (migration 158) refuse it. A policy that is slow to evaluate can
 *           run into the role's statement timeout (57014) — the door open, and
 *           the query running, not a refusal
 *   after   every relation refuses the public key: 401 with Postgres's 42501
 *           (permission denied), because anon holds no privilege in public
 *
 * A login's token is Better Auth's session token, never a JWT, so PostgREST
 * refuses it before it chooses any role — 401, PGRST301 — on every relation,
 * before the push and after it: what a signed-in browser holds opens nothing
 * at the Data API. The authenticated role's own lock, no privilege in public,
 * is `npm run check:rls` clause 5's, read from the catalog.
 *
 * The two logins are throwaways made for the run and removed at the end, under
 * the owner's coach (scripts/auth-fixtures.ts): a client through the invite
 * and a coach through the owner's command, whose roles the proof reads back.
 * The catalog counts are read too: 53 policies and 88 public-role grants (a
 * relation and a grantee) before, 0 and 0 after. The app's own doors are tried
 * through a next dev the script starts on a free port — the client's
 * `/api/client/me`, the coach's `/api/clients` — and must answer 200 in both
 * modes: the lock changes nothing the app does.
 */
import "./env-bootstrap";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createThrowawayLogin, deleteThrowawayLogin, loginIdFor } from "./auth-fixtures";
import { supabaseAdmin } from "@/services/supabase-admin";
import { dataApiPublicKey } from "./data-api-key";
import { endMintedSessions, mintSession, send, PROOF_BASE, type ProofSession } from "./proof-session";
import { startProofServer, stopProofServer } from "./proof-server";

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
const PUBLIC_KEY = dataApiPublicKey();

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
      apikey: PUBLIC_KEY,
      Authorization: `Bearer ${token ?? PUBLIC_KEY}`,
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

const refused = (cell: Cell) => cell.status === 401 && cell.code === "42501";
// PostgREST's answer to a bearer token it cannot read as a JWT: no role was chosen.
const unreadable = (cell: Cell) => cell.status === 401 && cell.code === "PGRST301";
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

async function main(): Promise<void> {
  console.info(`Mode: ${mode} the push — the Data API should be ${OPEN ? "open" : "locked"} to the public key.`);
  const { data: coach, error: coachError } = await supabaseAdmin.from("coaches").select("id").eq("email", COACH_EMAIL).single();
  if (coachError || !coach) throw new Error(`Coach not found: ${coachError?.message}`);

  const stamp = Date.now();
  const clientEmail = `data-api-locked-client-${stamp}@fixture.local`;
  const coachEmail = `data-api-locked-coach-${stamp}@fixture.local`;
  let clientId: string | null = null;
  const logins: Array<{ email: string; userId: string }> = [];

  try {
    await startProofServer();
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

    const password = () => `Proof-${stamp}-${Math.random().toString(36).slice(2)}`;
    const clientUser = await createThrowawayLogin({ role: "client", email: clientEmail, password: password(), clientId });
    logins.push({ email: clientEmail, userId: clientUser.userId });
    const coachUser = await createThrowawayLogin({ role: "coach", email: coachEmail, password: password(), name: "Data API locked proof coach" });
    logins.push({ email: coachEmail, userId: coachUser.userId });

    // The path that made each login decided its role (D9).
    const { data: clientProfile } = await supabaseAdmin.from("profiles").select("role").eq("user_id", clientUser.userId).maybeSingle();
    const { data: coachProfile } = await supabaseAdmin.from("profiles").select("role").eq("user_id", coachUser.userId).maybeSingle();
    const { count: coachRows } = await supabaseAdmin.from("coaches").select("id", { count: "exact", head: true }).eq("user_id", coachUser.userId);
    check("the invite made the client's login a client", clientProfile?.role === "client", clientProfile);
    check("…and the owner's command made the coach's login a trainer with a coaches row", coachProfile?.role === "trainer" && coachRows === 1, { coachProfile, coachRows });

    const clientSession = await mintSession(clientEmail, "client");
    const coachSession = await mintSession(coachEmail, "coach");

    const relations = relationsInPublic();
    check(`the live catalog lists the public relations (${relations.length})`, relations.length > 40, relations.length);

    console.info(`1. Every table and view in public, through the Data API (${mode} the push)`);
    const callers: Array<{ label: string; token: string | null }> = [
      { label: "public key", token: null },
      { label: "client token", token: clientSession.headers.Authorization.slice("Bearer ".length) },
      { label: "coach token", token: coachSession.headers.Authorization.slice("Bearer ".length) },
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
      if (caller.token !== null) {
        // Better Auth's token, never a JWT: refused before any role, in either mode.
        const read = Object.entries(cells).filter(([, c]) => !unreadable(c)).map(([n]) => n);
        check(
          `${caller.label}: refused unread on every one of ${relations.length} relations (401, PGRST301: not a JWT)`,
          read.length === 0,
          { notRefusedUnread: read.map((n) => ({ [n]: cells[n] })) },
        );
        continue;
      }
      const refusedNames = Object.entries(cells).filter(([, c]) => refused(c)).map(([n]) => n);
      const answeredNames = Object.entries(cells).filter(([, c]) => answered(c)).map(([n]) => n);
      const timedOutNames = Object.entries(cells).filter(([, c]) => timedOut(c)).map(([n]) => n);
      const other = Object.entries(cells).filter(([, c]) => !refused(c) && !answered(c) && !timedOut(c));
      if (OPEN) {
        const expectedRefused = new Set([...CLOSED_BEFORE, ...AUTHENTICATED_ONLY_BEFORE]);
        const wrong = Object.keys(cells).filter((n) => expectedRefused.has(n) !== refusedNames.includes(n));
        const slow = timedOutNames.length === 0 ? "" : `, ${timedOutNames.length} still running at the role's timeout (${timedOutNames.join(", ")})`;
        check(
          `${caller.label}: open — ${answeredNames.length} relations answer${slow}, ${refusedNames.length} refuse (the ones made closed at creation)`,
          wrong.length === 0 && other.length === 0,
          { wrong, other },
        );
      } else {
        check(
          `${caller.label}: refused on every one of ${relations.length} relations (401, 42501)`,
          refusedNames.length === relations.length && other.length === 0 && timedOutNames.length === 0,
          { answered: answeredNames, timedOut: timedOutNames, other },
        );
      }
    }
    if (OPEN) {
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
    const me = await appAnswers("/api/client/me", clientSession);
    const clients = await appAnswers("/api/clients", coachSession);
    check(`the client's /api/client/me answers 200 through the server (${PROOF_BASE})`, me === 200, me);
    check("the coach's /api/clients answers 200 through the server", clients === 200, clients);
  } finally {
    console.info("Cleanup");
    if (clientId) {
      const { error: auditError } = await supabaseAdmin.from("audit_logs").delete().eq("client_id", clientId);
      if (auditError) console.error(`  audit rows not deleted: ${auditError.message}`);
      const { error: clientError } = await supabaseAdmin.from("clients").delete().eq("id", clientId);
      if (clientError) console.error(`  client not deleted: ${clientError.message}`);
    }
    for (const { email } of logins) {
      try {
        await deleteThrowawayLogin(email);
      } catch (error) {
        console.error(`  login ${email} not deleted: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await endMintedSessions();
    if (clientId) {
      const { data: clientLeft } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
      check("cleanup: the client is gone", clientLeft === null, clientLeft);
    }
    for (const { email, userId } of logins) {
      const { data: profileLeft } = await supabaseAdmin.from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
      const { count: coachLeft } = await supabaseAdmin.from("coaches").select("id", { count: "exact", head: true }).eq("user_id", userId);
      const loginLeft = await loginIdFor(email);
      check(`cleanup: login ${userId.slice(0, 8)}… and its rows are gone`, profileLeft === null && coachLeft === 0 && loginLeft === null, { profileLeft, coachLeft, loginLeft });
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
