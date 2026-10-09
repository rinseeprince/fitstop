/**
 * Proof of docs/BETTER-AUTH-PLAN.md section 6 commit 8 (section 2.8; section 5,
 * proof 8): the client app's way in, over HTTP as the app sends it, against
 * the linked DEV database and a next dev this script starts on a free port
 * (never :3000). The app's requests carry its bearer token in Authorization,
 * no cookie and no Origin; its requests to Better Auth name the app's scheme
 * in expo-origin, as the Expo plugin's client sends them.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/bearer-proof.ts
 *
 *   1  sign-in: a client's email and password answer 200 and the bearer token
 *      in set-auth-token; another site named in expo-origin is refused (403
 *      INVALID_ORIGIN), so the Expo plugin reads that header
 *   2  GET /api/client/me with the token alone: 200, the client's own row
 *   3  PATCH /api/client/settings with the token, no cookie and no Origin: 200,
 *      saved; the session's cookie with no Origin, and the token with another
 *      site's Origin, are refused by the CSRF check (403, its answer)
 *   4  a garbage token and a forged signed one: 401 JSON, the proxy's, on a
 *      read and on a write
 *   5  a revoked token (signed out with itself): 401; the first token still
 *      opens the app
 *   6  the app's scheme: a sign-in with Origin atletafit:// is accepted and one
 *      with Origin https://evil.example refused (403); a password link and
 *      change email's links asked to land on the scheme are refused (403); the
 *      Expo plugin's Google proxy answers 404, even for the app's own Google
 *      sign-in
 *   7  renewal: a bearer session due for renewal keeps its expiry through the
 *      app's own routes; GET /api/auth/get-session renews it a week on, the
 *      token unchanged
 *   8  deletion, as the app confirms it: asking without the password is
 *      refused; with it, the link is asked for; the link opened where no one is
 *      signed in deletes nothing; requested with the bearer token, it deletes
 *      the login, its sessions and the client row
 * Cleanup removes the throwaway coach and client. No token, cookie or password
 * is printed.
 */
import "./env-bootstrap";

import { createHmac, randomBytes } from "node:crypto";
import { authPool } from "@/lib/auth";
import { CLIENT_APP_SCHEME } from "@/lib/constants";
import { supabaseAdmin } from "@/services/supabase-admin";
import { createThrowawayLogin, deleteThrowawayLogin, loginIdFor } from "./auth-fixtures";
import { DEV_REF, projectEnv, refuseUnlessProject } from "./project-ref";
import { startProofServer, stopProofServer, type ProofServer } from "./proof-server";
import { UNAUTHORIZED_TEXT } from "./proof-session";

const STAMP = Date.now();
const COACH_ADDRESS = `bearer-proof-${STAMP}@fixture.local`;
const CLIENT_ADDRESS = `bearer-proof-${STAMP}-client@fixture.local`;
const ADDRESS_PATTERN = "bearer-proof-%@fixture.local";
const REQUEST_TIMEOUT_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A session lasts this long from its last renewal (lib/auth.ts, D15). */
const SESSION_MS = 7 * DAY_MS;
const ELSEWHERE = "https://evil.example";

let failures = 0;
/** One check. Its detail is the evidence printed on failure: never a token, a cookie or a password. */
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

/** A throwaway's password, derived so that nothing writes it down. */
function passwordFor(label: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Missing BETTER_AUTH_SECRET in .env.local");
  return createHmac("sha256", secret).update(`${COACH_ADDRESS}:${label}`).digest("base64url").slice(0, 32);
}

/** The next dev this run started: its output is evidence. */
let devServer: ProofServer | null = null;
/** The client's login, kept for the cleanup's sweep of what Better Auth leaves behind a deleted login. */
let clientUserId: string | null = null;

// ---------------------------------------------------------------------------
// Requests and rows
// ---------------------------------------------------------------------------

type Answer = { status: number; json: unknown; text: string; headers: Headers };

/** One request with exactly these headers, as the app's fetch sends it: no cookie or Origin unless given. Redirects are not followed. */
async function request(
  base: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  { headers = {}, body }: { headers?: Record<string, string>; body?: unknown } = {}
): Promise<Answer> {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** An answer's evidence, any token in its body hidden (a sign-in answers with the session's). */
const evidence = (answer: Answer) => ({
  status: answer.status,
  code: (answer.json as { code?: string } | null)?.code,
  text: answer.text.replace(/"token":"[^"]*"/g, '"token":"<token>"').slice(0, 160),
});

/** The app's Authorization header for a token. */
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
/** What the Expo plugin's client sends Better Auth in place of an Origin. */
const FROM_APP = { "expo-origin": CLIENT_APP_SCHEME };

/** A sign-in posted as the app posts it, with what the answer carries back: its bearer token and its session cookie. */
async function signInAsApp(base: string, email: string, password: string, headers: Record<string, string> = FROM_APP) {
  const answer = await request(base, "POST", "/api/auth/sign-in/email", { headers, body: { email, password } });
  const cookie = answer.headers
    .getSetCookie()
    .map((set) => set.split(";")[0])
    .find((pair) => /^(__Secure-)?better-auth\.session_token=.+/.test(pair));
  return { answer, token: answer.headers.get("set-auth-token"), cookie: cookie ?? null };
}

/** The session row a bearer token names: the token is the row's token, signed. */
const rowToken = (token: string) => decodeURIComponent(token).split(".")[0] ?? "";

async function sessionExpiry(token: string): Promise<Date | null> {
  const { rows } = await authPool.query<{ expiresAt: Date }>(`SELECT "expiresAt" FROM better_auth.session WHERE token = $1`, [rowToken(token)]);
  return rows[0]?.expiresAt ?? null;
}

/** The newest live delete-account link's token Better Auth stored for a login, as its email carries it; empty for none. */
async function deleteLinkToken(userId: string): Promise<string> {
  const { rows } = await authPool.query<{ identifier: string }>(
    `SELECT identifier FROM better_auth.verification
      WHERE value = $1 AND identifier LIKE 'delete-account-%' AND "expiresAt" > now()
      ORDER BY "createdAt" DESC LIMIT 1`,
    [userId]
  );
  return rows[0]?.identifier.slice("delete-account-".length) ?? "";
}

/** Whether a token opens the app: GET /api/client/me answers 200 with the client's row. */
async function opensAs(base: string, token: string): Promise<{ status: number; email?: string; text: string }> {
  const me = await request(base, "GET", "/api/client/me", { headers: bearer(token) });
  return { status: me.status, email: (me.json as { data?: { email?: string } } | null)?.data?.email, text: me.text.slice(0, 160) };
}

/** The proxy's 401 for an /api request with no live session (rule 16): its JSON, never the login page. */
const isProxy401 = (answer: Answer) => answer.status === 401 && answer.text === UNAUTHORIZED_TEXT && answer.headers.get("location") === null;

/** The CSRF check's refusal (lib/csrf-protection.ts), told apart from any other 403 by its answer. */
const isCsrfRefusal = (answer: Answer) => answer.status === 403 && answer.text === JSON.stringify({ success: false, error: "CSRF validation failed" });

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

async function prove(base: string): Promise<void> {
  const coach = await createThrowawayLogin({ role: "coach", email: COACH_ADDRESS, password: passwordFor("coach"), name: "Bearer proof coach" });
  if (!coach.coachId) throw new Error(`No coach row for ${COACH_ADDRESS}`);
  const { data: clientRow, error: clientError } = await supabaseAdmin
    .from("clients")
    .insert({ coach_id: coach.coachId, name: "Bearer proof client", email: CLIENT_ADDRESS, active: true, onboarding_status: "pending_intake", timezone: "Europe/London", user_id: null })
    .select("id")
    .single();
  if (clientError || !clientRow) throw new Error(`client insert: ${clientError?.message}`);
  const clientPassword = passwordFor("client");
  const client = await createThrowawayLogin({ role: "client", email: CLIENT_ADDRESS, password: clientPassword, clientId: clientRow.id });
  clientUserId = client.userId;

  console.info("1. Sign-in: the client's email and password, as the app posts them");
  const signedIn = await signInAsApp(base, CLIENT_ADDRESS, clientPassword);
  check("POST /api/auth/sign-in/email answers 200", signedIn.answer.status === 200, evidence(signedIn.answer));
  const token = signedIn.token ?? "";
  check("the answer carries the bearer token in set-auth-token, the session's own", token !== "" && (await sessionExpiry(token)) !== null);
  const namedElsewhere = await signInAsApp(base, CLIENT_ADDRESS, clientPassword, { "expo-origin": ELSEWHERE });
  check(
    "another site named in expo-origin is refused: 403 INVALID_ORIGIN, so the Expo plugin reads the header as the request's origin",
    namedElsewhere.answer.status === 403 && (namedElsewhere.answer.json as { code?: string } | null)?.code === "INVALID_ORIGIN" && namedElsewhere.token === null,
    evidence(namedElsewhere.answer)
  );

  console.info("2. A read with the token alone");
  const me = await opensAs(base, token);
  check("GET /api/client/me with Authorization: Bearer, no cookie: 200, the client's own row", me.status === 200 && me.email === CLIENT_ADDRESS, me);

  console.info("3. A write with the token alone, no cookie and no Origin");
  const saved = await request(base, "PATCH", "/api/client/settings", { headers: bearer(token), body: { unitPreference: "imperial" } });
  const { data: afterSave } = await supabaseAdmin.from("clients").select("unit_preference").eq("id", clientRow.id).single();
  check("PATCH /api/client/settings: 200, and the change is saved", saved.status === 200 && afterSave?.unit_preference === "imperial", { ...evidence(saved), row: afterSave });
  const byCookie = signedIn.cookie
    ? await request(base, "PATCH", "/api/client/settings", { headers: { Cookie: signedIn.cookie }, body: { unitPreference: "metric" } })
    : null;
  check("the same write by the session's cookie with no Origin is refused by the CSRF check: 403, its answer", byCookie !== null && isCsrfRefusal(byCookie), byCookie ? evidence(byCookie) : "no cookie");
  const fromElsewhere = await request(base, "PATCH", "/api/client/settings", { headers: { ...bearer(token), Origin: ELSEWHERE }, body: { unitPreference: "metric" } });
  check("the token with another site's Origin is refused by the CSRF check: 403, its answer", isCsrfRefusal(fromElsewhere), evidence(fromElsewhere));
  const { data: afterRefusals } = await supabaseAdmin.from("clients").select("unit_preference").eq("id", clientRow.id).single();
  check("and neither refusal changed the row", afterRefusals?.unit_preference === "imperial", afterRefusals);

  console.info("4. A token that names no session");
  const garbage = "not-a-session-token";
  const forged = `${randomBytes(24).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
  for (const [label, dead] of [
    ["a garbage token", garbage],
    ["a forged signed token", forged],
  ] as const) {
    const read = await request(base, "GET", "/api/client/me", { headers: bearer(dead) });
    const write = await request(base, "PATCH", "/api/client/settings", { headers: bearer(dead), body: { unitPreference: "metric" } });
    check(`${label}: 401 JSON from the proxy on a read and on a write, which the CSRF pass gets nothing past`, isProxy401(read) && isProxy401(write), {
      read: evidence(read),
      write: evidence(write),
    });
  }

  console.info("5. A revoked token");
  const second = await signInAsApp(base, CLIENT_ADDRESS, clientPassword);
  const secondToken = second.token ?? "";
  check("a second sign-in's token opens the app", secondToken !== "" && (await opensAs(base, secondToken)).status === 200);
  const signedOut = await request(base, "POST", "/api/auth/sign-out", { headers: { ...FROM_APP, ...bearer(secondToken) }, body: {} });
  check("POST /api/auth/sign-out with that token: 200, its session row gone", signedOut.status === 200 && (await sessionExpiry(secondToken)) === null, evidence(signedOut));
  const revoked = await request(base, "GET", "/api/client/me", { headers: bearer(secondToken) });
  check("the revoked token: 401 JSON", isProxy401(revoked), evidence(revoked));
  check("the first token still opens the app", (await opensAs(base, token)).status === 200);

  console.info("6. The app's scheme");
  const schemeSignIn = await signInAsApp(base, CLIENT_ADDRESS, clientPassword, { Origin: CLIENT_APP_SCHEME });
  check(`a sign-in with Origin ${CLIENT_APP_SCHEME} is accepted: 200`, schemeSignIn.answer.status === 200, evidence(schemeSignIn.answer));
  const foreignSignIn = await signInAsApp(base, CLIENT_ADDRESS, clientPassword, { Origin: ELSEWHERE });
  check(
    `a sign-in with Origin ${ELSEWHERE} is refused: 403 INVALID_ORIGIN, no token`,
    foreignSignIn.answer.status === 403 && (foreignSignIn.answer.json as { code?: string } | null)?.code === "INVALID_ORIGIN" && foreignSignIn.token === null,
    evidence(foreignSignIn.answer)
  );
  const schemeLanding = await request(base, "POST", "/api/auth/request-password-reset", {
    headers: FROM_APP,
    body: { email: CLIENT_ADDRESS, redirectTo: `${CLIENT_APP_SCHEME}reset-password` },
  });
  const { rows: resetLinks } = await authPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM better_auth.verification WHERE value = $1 AND identifier LIKE 'reset-password:%'`,
    [client.userId]
  );
  check("a password link asked to land on the scheme is refused: 403, no link made", schemeLanding.status === 403 && resetLinks[0]?.n === 0, { ...evidence(schemeLanding), links: resetLinks[0] });
  const emailChange = await request(base, "POST", "/api/auth/change-email", {
    headers: { ...FROM_APP, ...bearer(token) },
    body: { newEmail: `bearer-proof-${STAMP}-new@fixture.local`, callbackURL: `${CLIENT_APP_SCHEME}client/settings` },
  });
  check(
    "change email asked, with the token, to land its links on the scheme is refused: 403, the address unchanged",
    emailChange.status === 403 && (await loginIdFor(CLIENT_ADDRESS)) === client.userId,
    evidence(emailChange)
  );
  const google = await request(base, "POST", "/api/auth/sign-in/social", { headers: FROM_APP, body: { provider: "google", callbackURL: `${CLIENT_APP_SCHEME}client` } });
  const authorizationURL = (google.json as { url?: string } | null)?.url ?? "";
  const state = URL.canParse(authorizationURL) ? new URL(authorizationURL).searchParams.get("state") : null;
  try {
    const proxied = await request(base, "GET", `/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL })}`);
    check(
      "the Expo plugin's Google proxy answers 404 even for the app's own Google sign-in: no state stored, the browser sent nowhere",
      google.status === 200 &&
        authorizationURL.startsWith("https://accounts.google.com/") &&
        proxied.status === 404 &&
        proxied.headers.get("location") === null &&
        proxied.headers.getSetCookie().length === 0,
      { google: evidence(google), proxied: { status: proxied.status, lands: proxied.headers.get("location") } }
    );
  } finally {
    // The sign-in's state, kept ten minutes for a return from Google that never comes.
    if (state) await authPool.query(`DELETE FROM better_auth.verification WHERE identifier = $1`, [`auth-state:${state}`]);
  }

  console.info("7. Renewal: the app's own routes never renew a session; GET /api/auth/get-session does");
  const { rows: made } = await authPool.query<{ expiresAt: Date }>(
    `UPDATE better_auth.session SET "expiresAt" = now() + interval '5 days', "updatedAt" = now() - interval '2 days'
      WHERE token = $1 RETURNING "expiresAt"`,
    [rowToken(token)]
  );
  const due = made[0]?.expiresAt ?? null;
  check("the first session is made due for renewal: renewed two days ago, so past a day's updateAge", due !== null);
  const throughApp = await opensAs(base, token);
  const keptExpiry = await sessionExpiry(token);
  check(
    "the app's routes read it without renewing: GET /api/client/me answers 200 and the expiry is unchanged",
    throughApp.status === 200 && due !== null && keptExpiry?.getTime() === due.getTime(),
    { status: throughApp.status, due, keptExpiry }
  );
  const renewed = await request(base, "GET", "/api/auth/get-session", { headers: bearer(token) });
  const renewedExpiry = await sessionExpiry(token);
  const renewedToken = renewed.headers.get("set-auth-token");
  check(
    "GET /api/auth/get-session with the token renews it: 200, its expiry a week from now",
    renewed.status === 200 && renewedExpiry !== null && Math.abs(renewedExpiry.getTime() - (Date.now() + SESSION_MS)) < 5 * 60_000,
    { status: renewed.status, renewedExpiry }
  );
  check(
    "the token is unchanged: the renewal's set-auth-token names the same session, and it still opens the app",
    renewedToken !== null && decodeURIComponent(renewedToken) === decodeURIComponent(token) && (await opensAs(base, token)).status === 200
  );

  console.info("8. Deletion, as the app confirms it");
  const unasked = await request(base, "POST", "/api/auth/delete-user", { headers: { ...FROM_APP, ...bearer(token) }, body: {} });
  check(
    "asking without the password is refused under the bearer token too: 400, no link made",
    unasked.status === 400 && (await deleteLinkToken(client.userId)) === "",
    evidence(unasked)
  );
  const asked = await request(base, "POST", "/api/auth/delete-user", { headers: { ...FROM_APP, ...bearer(token) }, body: { password: clientPassword } });
  check(
    "asking with the password: 200, the confirmation link asked for",
    asked.status === 200 && (asked.json as { message?: string } | null)?.message === "Verification email sent",
    evidence(asked)
  );
  const deleteToken = await deleteLinkToken(client.userId);
  check("the link's token is stored", deleteToken !== "");
  // The link as the email carries it: the dialog's landing defaults to the home page.
  const link = `/api/auth/delete-user/callback?token=${deleteToken}&callbackURL=%2F`;
  const inBrowser = await request(base, "GET", link);
  check(
    "the link opened where no one is signed in, as in the phone's browser: 404, nothing deleted",
    inBrowser.status === 404 && (await loginIdFor(CLIENT_ADDRESS)) === client.userId,
    evidence(inBrowser)
  );
  const confirmed = await request(base, "GET", link, { headers: bearer(token) });
  check("the link requested with the bearer token, as the app requests it: 302 to its landing", confirmed.status === 302 && confirmed.headers.get("location") === "/", {
    ...evidence(confirmed),
    lands: confirmed.headers.get("location"),
  });
  const { rows: left } = await authPool.query<{ logins: number; sessions: number }>(
    `SELECT (SELECT count(*) FROM better_auth."user" WHERE id = $1)::int AS logins,
            (SELECT count(*) FROM better_auth.session WHERE "userId" = $1)::int AS sessions`,
    [client.userId]
  );
  const { data: clientLeft } = await supabaseAdmin.from("clients").select("id").eq("id", clientRow.id);
  check("the login, its sessions and the client row are gone", left[0]?.logins === 0 && left[0]?.sessions === 0 && clientLeft?.length === 0, {
    ...left[0],
    clientRows: clientLeft?.length,
  });
  check("the token opens nothing: 401 JSON", isProxy401(await request(base, "GET", "/api/client/me", { headers: bearer(token) })));
}

async function cleanup(): Promise<void> {
  console.info("Cleanup");
  try {
    // The client's login first, unless step 8 deleted it: the coach's takes the coach row, and the client row with it.
    if (await loginIdFor(CLIENT_ADDRESS)) await deleteThrowawayLogin(CLIENT_ADDRESS);
    if (clientUserId) await authPool.query(`DELETE FROM better_auth.verification WHERE value = $1`, [clientUserId]);
    if (await loginIdFor(COACH_ADDRESS)) await deleteThrowawayLogin(COACH_ADDRESS);
    const { rows } = await authPool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM better_auth."user" WHERE email LIKE $1)
             + (SELECT count(*) FROM public.coaches WHERE email LIKE $1)
             + (SELECT count(*) FROM public.clients WHERE email LIKE $1)
             + (SELECT count(*) FROM better_auth.verification WHERE value = $2))::int AS n`,
      [ADDRESS_PATTERN, clientUserId ?? ""]
    );
    check("cleanup: no throwaway login, coach row, client row or link is left", rows[0]?.n === 0, rows[0]);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  refuseUnlessProject(DEV_REF, projectEnv());
  try {
    devServer = await startProofServer();
    await prove(devServer.base);
  } finally {
    try {
      await cleanup();
    } finally {
      await stopProofServer();
      await authPool.end();
    }
  }
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    // The server logs the addresses it answered, links' tokens among them.
    if (devServer) console.error(devServer.output.join("").replace(/token=[^&\s]+/g, "token=<token>").slice(-2000));
    process.exitCode = 1;
  } else {
    console.info("Every bearer check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
