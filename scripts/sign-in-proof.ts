/**
 * Request-level proof of docs/BETTER-AUTH-PLAN.md section 6 commit 2 (section
 * 5, proof 2): every sign-in runs on Better Auth, against the linked DEV
 * database through a next dev this script starts on a free port (never
 * :3000), with Better Auth's base URL and the app URL set to that port.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/sign-in-proof.ts
 *
 *   1  the owner's coach (a minted session, D34): /api/auth/me and /api/clients
 *      answer as before; "Test intake form bug": /api/client/me answers its row
 *   2  no session: a page is sent to /login, an API answers 401 JSON, /signup is
 *      gone; sign-up is refused and makes no login
 *   3  the role redirects: a client on /dashboard, a coach on /client, either
 *      on /login
 *   4  a throwaway coach (createCoachLogin) sets a password from the link's
 *      token and signs in over HTTP (a cookie); a wrong password is refused
 *   5  forgot password: the same answer for an unknown address, the link lands
 *      on /reset-password with its token, the reset works once, the old
 *      password fails, the earlier cookie is dead, a used link lands with
 *      error=INVALID_TOKEN
 *   6  an invited throwaway client: the token lookup shows no full address;
 *      the accept, its body naming another user, signs in the invited
 *      address and only it; a second accept of the token is refused
 *   7  the undo: an accept whose client already has a login leaves no login
 *      and no profile for the invited address
 *   8  every Set-Cookie the accept and the sign-in emit, and none from the proxy
 * No email is sent: the dev server's Resend client points at an unroutable
 * address and Sentry is off; every token is read from better_auth.verification
 * through the pool. Cleanup removes every throwaway and minted session, then
 * stops the dev server. No token, cookie or password is printed.
 */
import "./env-bootstrap";

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { supabaseAdmin } from "@/services/supabase-admin";
import { parseDatabaseUrl, supabaseConnection } from "@/lib/supabase-connection";
import { maskEmail } from "@/lib/mask-email";
import { passwordLinkToken } from "./auth-fixtures";
import { endSession, mintSession, signInOverHttp, type ProofSession } from "./proof-session";
import { NO_EMAIL, startProofServer, stopProofServer, type ProofServer } from "./proof-server";

const DEV_REF = "aeaphsslctwcmebldrzx";
const ROOT = join(__dirname, "..");
const COACH_EMAIL = "samuel.k@taboola.com";
// "Test intake form bug": the account every client-app smoke signs in as.
const SMOKE_CLIENT_EMAIL = "s.kalepa91+intake@gmail.com";
const STAMP = Date.now();
const ADDRESS = (who: string) => `sign-in-proof-${who}-${STAMP}@fixture.local`;
const ADDRESS_PATTERN = "sign-in-proof-%@fixture.local";
const REQUEST_TIMEOUT_MS = 60_000;
const UNAUTHORIZED = JSON.stringify({ success: false, error: "Unauthorized" });

// The script's own calls (createCoachLogin's link) send nothing either.
process.env.RESEND_BASE_URL = NO_EMAIL;

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

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

/** DEV only: the linked project, the pooler string and the Supabase URL must all name DEV's ref. */
function assertDev(): void {
  const linked = readFileSync(join(ROOT, "supabase/.temp/project-ref"), "utf8").trim();
  const database = parseDatabaseUrl(need("DATABASE_URL"));
  const supabase = new URL(need("NEXT_PUBLIC_SUPABASE_URL"));
  if (linked !== DEV_REF || database.username !== `postgres.${DEV_REF}` || supabase.hostname !== `${DEV_REF}.supabase.co`) {
    throw new Error(`Refused: this proof runs on DEV (${DEV_REF}) alone; the linked ref, DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL must all name it.`);
  }
}

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client(supabaseConnection(need("DATABASE_URL")));
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

/** A throwaway's password, derived so that nothing writes it down. */
function passwordFor(address: string, round = 0): string {
  return createHmac("sha256", need("BETTER_AUTH_SECRET")).update(`${address}:${round}`).digest("base64url").slice(0, 32);
}

/** The next dev this run started (scripts/proof-server.ts): its output is evidence. */
let devServer: ProofServer | null = null;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type Answer = { status: number; json: unknown; text: string; headers: Headers };

async function request(
  base: string,
  method: "GET" | "POST",
  path: string,
  options: { session?: ProofSession | null; body?: unknown; headers?: Record<string, string> } = {}
): Promise<Answer> {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      Origin: base,
      ...(options.session?.headers ?? {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
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

/** Where a redirect sends the browser, relative to the app; or the status when it is no redirect. */
const target = (base: string, answer: Answer) =>
  answer.status === 307 || answer.status === 302 ? (answer.headers.get("location") ?? "").replace(base, "") : `status ${answer.status}`;

const evidence = (answer: Answer) => ({ status: answer.status, code: (answer.json as { code?: string } | null)?.code, text: answer.text.slice(0, 160) });

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

type Made = { sessions: ProofSession[]; clients: string[]; coaches: string[] };

async function makeInvitedClient(made: Made, coachId: string, who: string): Promise<{ clientId: string; token: string; email: string }> {
  const email = ADDRESS(who);
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .insert({ coach_id: coachId, name: `Sign-in proof · ${who}`, email, active: true, onboarding_status: "pending_intake", timezone: "Europe/London", user_id: null })
    .select("id")
    .single();
  if (error || !client) throw new Error(`client insert: ${error?.message}`);
  made.clients.push(client.id);
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { error: inviteError } = await supabaseAdmin
    .from("client_invitations")
    .insert({ client_id: client.id, token, email, status: "sent", invited_at: new Date().toISOString(), expires_at: expires });
  if (inviteError) throw new Error(`invitation insert: ${inviteError.message}`);
  return { clientId: client.id, token, email };
}

async function prove(base: string, made: Made): Promise<void> {
  const { createCoachLogin } = await import("@/services/login-service");

  console.info("1. Minted sessions answer as before");
  const coach = await mintSession(COACH_EMAIL, "coach");
  const client = await mintSession(SMOKE_CLIENT_EMAIL, "client");
  made.sessions.push(coach, client);
  const me = await request(base, "GET", "/api/auth/me", { session: coach });
  const meData = (me.json as { data?: { profile?: { role?: string }; coach?: { email?: string } } } | null)?.data;
  check("the owner's coach: GET /api/auth/me → 200, a trainer with their coach row", me.status === 200 && meData?.profile?.role === "trainer" && meData.coach?.email === COACH_EMAIL, evidence(me));
  const roster = await request(base, "GET", "/api/clients", { session: coach });
  check("the owner's coach: GET /api/clients → 200, the roster", roster.status === 200 && Array.isArray((roster.json as { clients?: unknown[] } | null)?.clients), evidence(roster));
  const { data: smoke } = await supabaseAdmin.from("clients").select("id").eq("email", SMOKE_CLIENT_EMAIL).eq("active", true).single();
  const clientMe = await request(base, "GET", "/api/client/me", { session: client });
  check("Test intake form bug: GET /api/client/me → 200, their own row", clientMe.status === 200 && (clientMe.json as { data?: { id?: string } } | null)?.data?.id === smoke?.id, evidence(clientMe));

  console.info("2. No session");
  const dashboard = await request(base, "GET", "/dashboard");
  check("/dashboard → 307 to /login", target(base, dashboard) === "/login", evidence(dashboard));
  const clients = await request(base, "GET", "/api/clients");
  check("/api/clients → 401 JSON, not the login page", clients.status === 401 && clients.text === UNAUTHORIZED && clients.headers.get("location") === null, evidence(clients));
  const signupPage = await request(base, "GET", "/signup");
  check("/signup is gone: signed out it is sent to /login", target(base, signupPage) === "/login", evidence(signupPage));
  const signUpAddress = ADDRESS("signup");
  const signUp = await request(base, "POST", "/api/auth/sign-up/email", { body: { email: signUpAddress, password: passwordFor(signUpAddress), name: "Nobody" } });
  const [signedUp] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM better_auth."user" WHERE email = $1`, [signUpAddress]);
  check("sign-up → refused (EMAIL_PASSWORD_SIGN_UP_DISABLED), and no login made", signUp.status === 400 && evidence(signUp).code === "EMAIL_PASSWORD_SIGN_UP_DISABLED" && signedUp?.n === 0, evidence(signUp));

  console.info("3. The role redirects");
  const clientOnDashboard = await request(base, "GET", "/dashboard", { session: client });
  check("a client on /dashboard → 307 to /client", target(base, clientOnDashboard) === "/client", evidence(clientOnDashboard));
  const coachOnClient = await request(base, "GET", "/client", { session: coach });
  check("a coach on /client → 307 to /dashboard", target(base, coachOnClient) === "/dashboard", evidence(coachOnClient));
  const coachOnLogin = await request(base, "GET", "/login", { session: coach });
  check("a coach on /login → 307 to /dashboard", target(base, coachOnLogin) === "/dashboard", evidence(coachOnLogin));

  console.info("4. A throwaway coach sets a password and signs in over HTTP");
  const coachEmail = ADDRESS("coach");
  const coachUserId = await createCoachLogin({ email: coachEmail, name: "Sign-in proof · coach" });
  const { data: coachRow } = await supabaseAdmin.from("coaches").select("id").eq("user_id", coachUserId).single();
  if (coachRow) made.coaches.push(coachRow.id);
  const [credentialless] = await sql<{ verified: boolean; credentials: number }>(
    `SELECT u."emailVerified" AS verified, (SELECT count(*)::int FROM better_auth.account a WHERE a."userId" = u.id) AS credentials
       FROM better_auth."user" u WHERE u.id = $1`,
    [coachUserId]
  );
  check("createCoachLogin: a verified login with no password, its trainer profile and coach row", credentialless?.verified === true && credentialless.credentials === 0 && !!coachRow, credentialless);
  const firstPassword = passwordFor(coachEmail);
  const setPassword = await request(base, "POST", "/api/auth/reset-password", { body: { newPassword: firstPassword, token: await passwordLinkToken(coachUserId) } });
  check("the set-password link's token sets the first password", setPassword.status === 200, evidence(setPassword));
  const cookieSession = await signInOverHttp(base, coachEmail, firstPassword, "throwaway coach");
  const coachDashboard = await request(base, "GET", "/dashboard", { session: cookieSession });
  check("signed in over HTTP, the cookie opens /dashboard (200)", coachDashboard.status === 200, evidence(coachDashboard));
  const wrong = await request(base, "POST", "/api/auth/sign-in/email", { body: { email: coachEmail, password: `${firstPassword}x` } });
  check("a wrong password → 401 INVALID_EMAIL_OR_PASSWORD, no cookie", wrong.status === 401 && evidence(wrong).code === "INVALID_EMAIL_OR_PASSWORD" && wrong.headers.getSetCookie().length === 0, evidence(wrong));

  console.info("5. Forgot password and the reset link");
  const ask = (email: string) => request(base, "POST", "/api/auth/request-password-reset", { body: { email, redirectTo: "/reset-password" } });
  const known = await ask(coachEmail);
  const unknown = await ask(ADDRESS("nobody"));
  check("the same answer for an address with a login and one without", known.status === 200 && known.text === unknown.text, { known: evidence(known), unknown: evidence(unknown) });
  const token = await passwordLinkToken(coachUserId);
  const link = `/api/auth/reset-password/${token}?callbackURL=%2Freset-password`;
  const click = await request(base, "GET", link);
  check("the link lands on /reset-password with its token", target(base, click) === `/reset-password?token=${token}`, { status: click.status, lands: target(base, click).replace(token, "<token>") });
  const page = await request(base, "GET", `/reset-password?token=${token}`);
  check("/reset-password opens signed out (200)", page.status === 200, evidence(page));
  const newPassword = passwordFor(coachEmail, 1);
  const reset = await request(base, "POST", "/api/auth/reset-password", { body: { newPassword, token } });
  check("the reset sets the new password", reset.status === 200, evidence(reset));
  const old = await request(base, "POST", "/api/auth/sign-in/email", { body: { email: coachEmail, password: firstPassword } });
  check("the old password now fails (401)", old.status === 401, evidence(old));
  const afterReset = await request(base, "GET", "/dashboard", { session: cookieSession });
  check("the cookie from before the reset is dead: /dashboard → 307 to /login", target(base, afterReset) === "/login", evidence(afterReset));
  const fresh = await signInOverHttp(base, coachEmail, newPassword, "throwaway coach, new password");
  check("the new password signs in", !!fresh.headers.Cookie);
  const usedClick = await request(base, "GET", link);
  check("the used link lands with error=INVALID_TOKEN", target(base, usedClick) === "/reset-password?error=INVALID_TOKEN", { lands: target(base, usedClick) });
  const expiredPage = await request(base, "GET", "/reset-password?error=INVALID_TOKEN");
  check("/reset-password?error=INVALID_TOKEN opens (200; its sentence is the page's own test's)", expiredPage.status === 200, evidence(expiredPage));
  check(
    "inside a request the reset email went to after(): the dev server never ran it outside one",
    !(devServer?.output.join("") ?? "").includes("outside a request")
  );

  console.info("6. The invite");
  if (!coachRow) throw new Error("No coach row for the throwaway coach");
  const invited = await makeInvitedClient(made, coachRow.id, "client");
  const lookup = await request(base, "GET", `/api/invitations/${invited.token}`);
  const shown = (lookup.json as { invitation?: { coachName?: string; emailMasked?: string } } | null)?.invitation;
  check(
    "the token lookup shows the coach's name and the masked address, and no full address",
    lookup.status === 200 && shown?.coachName === "Sign-in proof · coach" && shown.emailMasked === maskEmail(invited.email) &&
      !lookup.text.includes(invited.email.split("@")[0]),
    { status: lookup.status, shown }
  );
  const accepted = await request(base, "POST", "/api/invitations/accept", {
    body: { token: invited.token, password: passwordFor(invited.email), userId: coachUserId },
  });
  const acceptCookies = accepted.headers.getSetCookie();
  const acceptCookie = acceptCookies.map((set) => set.split(";")[0]).find((pair) => pair.startsWith("better-auth.session_token="));
  check("the accept → 200 with the session cookie", accepted.status === 200 && !!acceptCookie, evidence(accepted));
  const invitedSession: ProofSession = { label: "invited client", headers: { Cookie: acceptCookie ?? "" } };
  const invitedMe = await request(base, "GET", "/api/client/me", { session: invitedSession });
  check("the cookie opens /api/client/me as the invited client, never the user the body named", invitedMe.status === 200 && (invitedMe.json as { data?: { id?: string } } | null)?.data?.id === invited.clientId, evidence(invitedMe));
  const [login] = await sql<{ id: string; verified: boolean; role: string | null; linked: boolean; status: string }>(
    `SELECT u.id, u."emailVerified" AS verified, p.role, (c.user_id = u.id) AS linked, i.status
       FROM better_auth."user" u
       LEFT JOIN public.profiles p ON p.user_id = u.id
       JOIN public.clients c ON c.id = $2
       JOIN public.client_invitations i ON i.client_id = c.id
      WHERE u.email = $1`,
    [invited.email, invited.clientId]
  );
  check("the login is on the invited address, verified, a client, linked, and the invitation accepted", login?.verified === true && login.role === "client" && login.linked === true && login.status === "accepted", login);
  const again = await request(base, "POST", "/api/invitations/accept", { body: { token: invited.token, password: passwordFor(invited.email, 1) } });
  check("a second accept of the token → 400, already used", again.status === 400 && (again.json as { error?: string } | null)?.error === "This invitation has already been used", evidence(again));
  const usedLookup = await request(base, "GET", `/api/invitations/${invited.token}`);
  check("and the lookup says the link was used", (usedLookup.json as { error?: string } | null)?.error === "This invitation has already been used", evidence(usedLookup));

  console.info("7. The undo");
  const linkedAlready = await makeInvitedClient(made, coachRow.id, "linked");
  await supabaseAdmin.from("clients").update({ user_id: coachUserId }).eq("id", linkedAlready.clientId);
  const refused = await request(base, "POST", "/api/invitations/accept", { body: { token: linkedAlready.token, password: passwordFor(linkedAlready.email) } });
  const [left] = await sql<{ logins: number; profiles: number }>(
    `SELECT (SELECT count(*)::int FROM better_auth."user" WHERE email = $1) AS logins,
            (SELECT count(*)::int FROM public.profiles p JOIN better_auth."user" u ON u.id = p.user_id WHERE u.email = $1) AS profiles`,
    [linkedAlready.email]
  );
  check(
    "an accept whose client already has a login is refused, and leaves no login and no profile for the invited address",
    refused.status === 400 && left?.logins === 0 && left.profiles === 0,
    { refused: evidence(refused), left }
  );

  console.info("8. Set-Cookie");
  for (const set of acceptCookies) console.info(`  accept: ${set.replace(/=[^;]*/, "=<value>")}`);
  const signIn = await request(base, "POST", "/api/auth/sign-in/email", { body: { email: coachEmail, password: newPassword } });
  for (const set of signIn.headers.getSetCookie()) console.info(`  sign-in: ${set.replace(/=[^;]*/, "=<value>")}`);
  const sessionSet = acceptCookies.find((set) => set.startsWith("better-auth.session_token="));
  check(
    "the session cookie is HttpOnly, SameSite=Lax, Path=/, seven days (Secure comes with https)",
    !!sessionSet && /HttpOnly/i.test(sessionSet) && /SameSite=Lax/i.test(sessionSet) && /Path=\//.test(sessionSet) && /Max-Age=604800/.test(sessionSet),
    sessionSet?.replace(/=[^;]*/, "=<value>")
  );
  const proxied = [dashboard, clients, clientOnDashboard, coachOnClient, coachDashboard, afterReset];
  check("the proxy sets no cookie on any answer above", proxied.every((answer) => answer.headers.getSetCookie().length === 0));
}

async function cleanup(made: Made): Promise<void> {
  console.info("Cleanup");
  try {
    // createCoachLogin ran outside a request: its email is still on its way.
    const { backgroundWorkSettled } = await import("@/lib/auth");
    await backgroundWorkSettled();
    for (const session of made.sessions) await endSession(session);
    if (made.clients.length) await supabaseAdmin.from("clients").delete().in("id", made.clients);
    if (made.coaches.length) await supabaseAdmin.from("coaches").delete().in("id", made.coaches);
    await sql(`DELETE FROM better_auth."user" WHERE email LIKE $1`, [ADDRESS_PATTERN]);
    const [left] = await sql<{ n: number }>(
      `SELECT ((SELECT count(*) FROM better_auth."user" WHERE email LIKE $1)
             + (SELECT count(*) FROM public.clients WHERE email LIKE $1)
             + (SELECT count(*) FROM public.coaches WHERE email LIKE $1)
             + (SELECT count(*) FROM better_auth.session WHERE "userAgent" = 'proof-session' AND "expiresAt" > now()))::int AS n`,
      [ADDRESS_PATTERN]
    );
    check("cleanup: every throwaway login, client, coach and minted session is gone", left?.n === 0, left);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  assertDev();
  const made: Made = { sessions: [], clients: [], coaches: [] };
  try {
    devServer = await startProofServer();
    await prove(devServer.base, made);
  } finally {
    try {
      await cleanup(made);
    } finally {
      await stopProofServer();
    }
  }
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    if (devServer) console.error(devServer.output.join("").slice(-2000));
    process.exitCode = 1;
  } else {
    console.info("Every sign-in check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
