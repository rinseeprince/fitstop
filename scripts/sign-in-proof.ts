/**
 * Request-level proof of docs/DATA-ACCESS-LOCKDOWN-PLAN.md §6 commit 5: the
 * sign-in reads — the middleware's role, the auth seam's coach and client
 * lookups — go through the server, keyed on the user id the session
 * validated, and every role and every redirect answers as it did. Against the
 * linked DEV database through a running `next dev`.
 *
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/sign-in-proof.ts record before
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/sign-in-proof.ts record after
 *   WIRE_PROOF_DIR=<scratchpad> npx tsx scripts/sign-in-proof.ts diff before after
 *   npx tsx scripts/sign-in-proof.ts access before|after
 *
 * `record` writes GET /api/auth/me whole — its status, Cache-Control, content
 * type and body — for the owner's coach and for the client-app smoke account.
 * `diff` holds both byte-identical. The recordings go to WIRE_PROOF_DIR,
 * outside the tree, and are never committed.
 *
 * `access` proves each role and each redirect with real sessions, on
 * throwaways made for the run and removed at the end: a deactivated client of
 * the owner's coach with a login, and a login whose profile row is gone.
 * Between commit 5's before and after nothing changes (which code the dev
 * server served was shown outside this script: the edge chunk's reference to
 * the service key, and pg_stat_statements' per-role call counts on the three
 * tables). Case 8's public pages are the one answer the follow-up fix
 * changes, so the mode decides their expectation.
 *   1  the coach: a coach page and two coach APIs answer 200
 *   2  the client: their home and a client API answer 200
 *   3  the client on coach URLs: a coach page → 307 to /client; a coach API →
 *      401 from the seam (the middleware leaves /api/** to the route)
 *   4  the coach on client URLs: the client home → 307 to /dashboard; a client
 *      API → 401
 *   5  no session: every page and API → 307 to /login, bare; the login page
 *      itself 200
 *   6  signed in on /, /login and /signup → 307 to the role's home
 *   7  a deactivated client: the middleware knows only the role, so their
 *      home answers 200 and a coach page sends them to /client; the seam's
 *      active filter answers 401 on a client API
 *   8  a login with no profile row: every guarded page → 307 to
 *      /login?error=profile_unavailable, before any route runs. On /, /login
 *      and /signup: before, the public-page branch found no role and sent them
 *      to /dashboard, which sent them back to /login — a loop the browser gave
 *      up on; after, the page shows (200). The login page's message is a
 *      client leaf, proven by components/auth/login-notice.test.tsx and seen
 *      in the browser smoke
 */
import "./env-bootstrap";

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/services/supabase-admin";
import { mintSession, send, PROOF_BASE, type ProofResponse, type ProofSession } from "./proof-session";

const COACH_EMAIL = "samuel.k@taboola.com";
// "Test intake form bug": the account every client-app smoke signs in as.
const SMOKE_CLIENT_EMAIL = "s.kalepa91+intake@gmail.com";

async function ownerCoachId(): Promise<string> {
  const { data, error } = await supabaseAdmin.from("coaches").select("id").eq("email", COACH_EMAIL).single();
  if (error || !data) throw new Error(`Coach not found: ${error?.message}`);
  return data.id;
}

// ---------------------------------------------------------------------------
// record / diff
// ---------------------------------------------------------------------------

function proofDir(label: string): string {
  const root = process.env.WIRE_PROOF_DIR;
  if (!root) throw new Error("Set WIRE_PROOF_DIR to a folder outside the tree (the scratchpad)");
  return join(root, "sign-in", label);
}

/** The whole response a browser receives, as one text: status, headers that matter, body. */
async function capture(session: ProofSession | null, path: string): Promise<{ status: number; location: string; text: string }> {
  const res = await fetch(`${PROOF_BASE}${path}`, {
    headers: { ...(session ? { Cookie: session.cookie } : {}), Origin: PROOF_BASE, Accept: "application/json" },
    redirect: "manual",
  });
  const body = await res.text();
  const text = [
    `status: ${res.status}`,
    `cache-control: ${res.headers.get("cache-control") ?? ""}`,
    `content-type: ${res.headers.get("content-type") ?? ""}`,
    "",
    body,
  ].join("\n");
  return { status: res.status, location: res.headers.get("location") ?? "", text };
}

async function recordOne(dir: string, name: string, session: ProofSession, path: string): Promise<void> {
  const { status, text } = await capture(session, path);
  if (status !== 200) throw new Error(`${session.label} ${path} → ${status}: ${text.slice(0, 300)}`);
  writeFileSync(join(dir, `${name}.txt`), text);
  console.info(`  ${name}  ←  ${path}`);
}

async function record(label: string): Promise<void> {
  const dir = proofDir(label);
  mkdirSync(dir, { recursive: true });
  console.info(`Recording "${label}" into ${dir} against ${PROOF_BASE}`);
  const coach = await mintSession(COACH_EMAIL, "coach");
  await recordOne(dir, "me-coach", coach, "/api/auth/me");
  const client = await mintSession(SMOKE_CLIENT_EMAIL, "smoke");
  await recordOne(dir, "me-client", client, "/api/auth/me");
  console.info("Done.");
}

function diff(before: string, after: string): void {
  const a = proofDir(before);
  const b = proofDir(after);
  const names = [...new Set([...readdirSync(a), ...readdirSync(b)])].sort();
  let failures = 0;
  for (const name of names) {
    const pa = join(a, name);
    const pb = join(b, name);
    if (!existsSync(pa) || !existsSync(pb)) {
      failures += 1;
      console.error(`✗ ${name}: recorded in ${existsSync(pa) ? before : after} only`);
      continue;
    }
    const ta = readFileSync(pa, "utf8");
    const tb = readFileSync(pb, "utf8");
    if (ta === tb) {
      console.info(`= ${name}: byte-identical (${Buffer.byteLength(ta)} bytes)`);
      continue;
    }
    failures += 1;
    let at = 0;
    while (at < ta.length && ta[at] === tb[at]) at += 1;
    console.error(`✗ ${name}: differs at byte ${at}`);
    console.error(`    ${before}: …${ta.slice(Math.max(0, at - 60), at + 60)}…`);
    console.error(`    ${after}:  …${tb.slice(Math.max(0, at - 60), at + 60)}…`);
  }
  if (failures > 0) {
    console.error(`${failures} of ${names.length} response(s) differ`);
    process.exitCode = 1;
  } else {
    console.info(`Every response holds: ${names.length} byte-identical.`);
  }
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

function answers(res: ProofResponse, status: number, body: unknown): boolean {
  return res.status === status && res.text === JSON.stringify(body);
}

const seen = (res: { status: number; text: string; location?: string }) => ({
  status: res.status,
  location: res.location,
  text: res.text.slice(0, 200),
});

/** A page or API as the session (or none), never following a redirect. */
async function open(session: ProofSession | null, path: string) {
  return capture(session, path);
}

/** The redirect's target, relative to the app, with its query. */
const target = (res: { status: number; location: string }) =>
  res.status === 307 ? res.location.replace(PROOF_BASE, "") : `status ${res.status}`;

type Made = { users: string[]; clients: string[] };

async function makeClient(made: Made, coachId: string, name: string, email: string, active: boolean): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({
      coach_id: coachId,
      name,
      email,
      active,
      onboarding_status: "active",
      timezone: "Europe/London",
      user_id: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`client insert: ${error?.message}`);
  made.clients.push(data.id);
  return data.id;
}

/** A login. With `inviteFor`, an invitation row first, so the signup trigger makes it a client, not a coach. */
async function makeLogin(made: Made, email: string, stamp: number, inviteFor?: string): Promise<string> {
  if (inviteFor) {
    const { error } = await supabaseAdmin.from("client_invitations").insert({ client_id: inviteFor, email, status: "accepted" });
    if (error) throw new Error(`invitation insert: ${error.message}`);
  }
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: `Sign-in-proof-${stamp}-${Math.random().toString(36).slice(2)}`,
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  made.users.push(data.user.id);
  return data.user.id;
}

async function link(clientId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("clients").update({ user_id: userId }).eq("id", clientId);
  if (error) throw new Error(`client link: ${error.message}`);
}

async function access(mode: "before" | "after"): Promise<void> {
  console.info(`Access proof, ${mode} the change, against ${PROOF_BASE}`);
  const AFTER = mode === "after";
  const coachId = await ownerCoachId();
  const stamp = Date.now();
  const email = (who: string) => `sign-in-proof-${who}-${stamp}@fixture.local`;
  const made: Made = { users: [], clients: [] };
  // The two 401 bodies: /api/clients answers bare, the envelope routes answer { success: false }.
  const UNAUTHORIZED_BARE = { error: "Unauthorized" };
  const UNAUTHORIZED_ENVELOPE = { success: false, error: "Unauthorized" };

  try {
    console.info("Setup: a deactivated client of the owner's coach with a login; a login with no profile row");
    const deactivated = await makeClient(made, coachId, "Sign-in proof · deactivated client", email("deactivated"), false);
    await link(deactivated, await makeLogin(made, email("deactivated"), stamp, deactivated));
    const profileless = await makeLogin(made, email("no-profile"), stamp);
    const { error: profileGone } = await supabaseAdmin.from("profiles").delete().eq("user_id", profileless);
    if (profileGone) throw new Error(`profile delete: ${profileGone.message}`);

    const coach = await mintSession(COACH_EMAIL, "coach");
    const client = await mintSession(SMOKE_CLIENT_EMAIL, "client");
    const deactivatedSession = await mintSession(email("deactivated"), "deactivated client");
    const profilelessSession = await mintSession(email("no-profile"), "no profile row");
    const { data: smoke, error: smokeError } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("email", SMOKE_CLIENT_EMAIL)
      .eq("active", true)
      .single();
    if (smokeError || !smoke) throw new Error(`smoke client: ${smokeError?.message}`);

    console.info("1. The coach");
    const dashboard = await open(coach, "/dashboard");
    check("the dashboard → 200", dashboard.status === 200, seen(dashboard));
    const clients = await send(coach, "GET", "/api/clients");
    const roster = (clients.json as { clients?: unknown[] } | null)?.clients;
    check("GET /api/clients → 200, the roster", clients.status === 200 && Array.isArray(roster), seen(clients));
    const feed = await send(coach, "GET", "/api/dashboard/attention-feed");
    check("GET /api/dashboard/attention-feed → 200", feed.status === 200, seen(feed));

    console.info("2. The client");
    const home = await open(client, "/client");
    check("their home → 200", home.status === 200, seen(home));
    const me = await send(client, "GET", "/api/client/me");
    check(
      "GET /api/client/me → 200, their own row",
      me.status === 200 && (me.json as { data?: { id?: string } } | null)?.data?.id === smoke.id,
      seen(me)
    );

    console.info("3. The client on coach URLs");
    for (const path of ["/dashboard", "/clients", `/clients/${smoke.id}`, "/settings"]) {
      const res = await open(client, path);
      check(`${path} → 307 to /client`, target(res) === "/client", seen(res));
    }
    check("GET /api/clients → 401 from the seam", answers(await send(client, "GET", "/api/clients"), 401, UNAUTHORIZED_BARE));
    check(
      "GET /api/dashboard/attention-feed → 401 from the seam",
      answers(await send(client, "GET", "/api/dashboard/attention-feed"), 401, UNAUTHORIZED_ENVELOPE)
    );

    console.info("4. The coach on client URLs");
    for (const path of ["/client", "/client/training", "/client/check-in"]) {
      const res = await open(coach, path);
      check(`${path} → 307 to /dashboard`, target(res) === "/dashboard", seen(res));
    }
    check("GET /api/client/me → 401 from the seam", answers(await send(coach, "GET", "/api/client/me"), 401, UNAUTHORIZED_ENVELOPE));

    console.info("5. No session");
    for (const path of ["/dashboard", `/clients/${smoke.id}`, "/client", "/client/training", "/api/clients", "/api/client/me", "/api/auth/me"]) {
      const res = await open(null, path);
      check(`${path} → 307 to /login, bare`, target(res) === "/login", seen(res));
    }
    const login = await open(null, "/login");
    check("/login → 200", login.status === 200, seen(login));
    const signup = await open(null, "/signup");
    check("/signup → 200", signup.status === 200, seen(signup));

    console.info("6. Signed in on the public pages");
    for (const path of ["/", "/login", "/signup"]) {
      const asCoach = await open(coach, path);
      check(`the coach on ${path} → 307 to /dashboard`, target(asCoach) === "/dashboard", seen(asCoach));
      const asClient = await open(client, path);
      check(`the client on ${path} → 307 to /client`, target(asClient) === "/client", seen(asClient));
    }

    console.info("7. A deactivated client");
    const deactivatedHome = await open(deactivatedSession, "/client");
    check("their home → 200 (the middleware knows only the role)", deactivatedHome.status === 200, seen(deactivatedHome));
    const deactivatedDashboard = await open(deactivatedSession, "/dashboard");
    check("the dashboard → 307 to /client", target(deactivatedDashboard) === "/client", seen(deactivatedDashboard));
    check(
      "GET /api/client/me → 401 (the seam's active filter)",
      answers(await send(deactivatedSession, "GET", "/api/client/me"), 401, UNAUTHORIZED_ENVELOPE)
    );
    const deactivatedMe = await send(deactivatedSession, "GET", "/api/auth/me");
    check(
      "GET /api/auth/me → 200, a client profile with no coach",
      deactivatedMe.status === 200 &&
        (deactivatedMe.json as { data?: { profile?: { role?: string }; coach?: unknown } } | null)?.data?.profile?.role === "client" &&
        (deactivatedMe.json as { data?: { coach?: unknown } }).data?.coach === null,
      seen(deactivatedMe)
    );

    console.info("8. A login with no profile row");
    for (const path of ["/dashboard", "/client", "/api/auth/me"]) {
      const res = await open(profilelessSession, path);
      check(`${path} → 307 to /login?error=profile_unavailable`, target(res) === "/login?error=profile_unavailable", seen(res));
    }
    for (const path of ["/", "/login", "/signup"]) {
      const res = await open(profilelessSession, path);
      check(
        AFTER ? `${path} → 200, the page shows` : `${path} → 307 to /dashboard (no role found: the public-page branch's default)`,
        AFTER ? res.status === 200 : target(res) === "/dashboard",
        seen(res)
      );
    }
    const withError = await open(profilelessSession, "/login?error=profile_unavailable");
    check(
      AFTER ? "/login?error=profile_unavailable → 200, the page shows (the message is the browser smoke's)" : "/login?error=profile_unavailable → 307 to /dashboard (the loop's other half)",
      AFTER ? withError.status === 200 : target(withError) === "/dashboard",
      seen(withError)
    );
  } finally {
    console.info("Cleanup");
    for (const id of made.clients) {
      const { error } = await supabaseAdmin.from("clients").delete().eq("id", id);
      if (error) console.error(`  client not deleted: ${error.message}`);
    }
    for (const id of made.users) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (error) console.error(`  login not deleted: ${error.message}`);
    }
    let left = 0;
    for (const id of made.clients) {
      const { data } = await supabaseAdmin.from("clients").select("id").eq("id", id).maybeSingle();
      left += data ? 1 : 0;
    }
    for (const id of made.users) {
      const { data } = await supabaseAdmin.from("profiles").select("user_id").eq("user_id", id).maybeSingle();
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(id);
      left += data || user?.user ? 1 : 0;
    }
    check(`cleanup: ${made.clients.length} client and ${made.users.length} logins are gone`, left === 0, { left });
  }

  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.info("Every check holds.");
  }
}

async function main(): Promise<void> {
  const [mode, first, second] = process.argv.slice(2);
  if (mode === "record" && first) return record(first);
  if (mode === "diff" && first && second) return diff(first, second);
  if (mode === "access" && (first === "before" || first === "after")) return access(first);
  throw new Error("usage: record <label> | diff <before> <after> | access before|after");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
