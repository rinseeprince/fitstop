/**
 * Real sessions for the request-level proof scripts, and the request helper
 * every proof uses against a running `next dev` (D34).
 *
 * mintSession needs no browser and no password: it inserts a session row into
 * better_auth.session through the pool and sends its token as a bearer token,
 * which Better Auth's bearer plugin reads as that session wherever the app
 * asks who is signed in (the proxy, the auth seam, /api/auth/*). A proof that
 * must drive the cookie path signs in over HTTP with a throwaway's password
 * (signInOverHttp) and keeps the session cookie the answer set.
 *
 * A vitest that mocks `supabaseAdmin` proves nothing about a route's chain or a
 * wire; these scripts drive the real thing against the linked DEV project.
 */
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { supabaseConnection } from "@/lib/supabase-connection";

export const PROOF_BASE = process.env.WIRE_PROOF_BASE ?? "http://localhost:3000";

/** A session the proofs drive the app as, by the header that carries it: Authorization (minted) or Cookie (signed in). */
export type ProofSession = { label: string; headers: Record<string, string> };

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

/** One statement through Better Auth's own connection (the postgres user through the pooler, TLS verified). */
async function sql<T>(text: string, values: unknown[]): Promise<T[]> {
  const client = new Client(supabaseConnection(need("DATABASE_URL")));
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Long enough for a proof run; a minted session is never a week's. */
const MINTED_SESSION_HOURS = 2;

/** A session for the login with this address, sent as a bearer token. */
export async function mintSession(email: string, label: string): Promise<ProofSession> {
  // No dot: the bearer plugin signs a bare token itself, so no script holds the secret.
  const token = randomBytes(24).toString("base64url");
  const rows = await sql<{ userId: string }>(
    `INSERT INTO better_auth.session ("userId", token, "expiresAt", "userAgent")
     SELECT id, $2, now() + make_interval(hours => $3), 'proof-session'
       FROM better_auth."user" WHERE email = lower($1)
     RETURNING "userId"`,
    [email, token, MINTED_SESSION_HOURS]
  );
  if (rows.length !== 1) throw new Error(`No Better Auth login for ${email}`);
  return { label, headers: { Authorization: `Bearer ${token}` } };
}

/** Ends a minted session: its row goes, so its token opens nothing. */
export async function endSession(session: ProofSession): Promise<void> {
  const bearer = session.headers.Authorization;
  if (!bearer) return;
  await sql(`DELETE FROM better_auth.session WHERE token = $1`, [bearer.slice("Bearer ".length)]);
}

/**
 * Signs in as a browser does: POST /api/auth/sign-in/email from the app's
 * origin (`base`), keeping the session cookie the answer set. Throws with the
 * status and Better Auth's code when the sign-in is refused.
 */
export async function signInOverHttp(base: string, email: string, password: string, label: string): Promise<ProofSession> {
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password }),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((set) => set.split(";")[0])
    .find((pair) => /^(__Secure-)?better-auth\.session_token=/.test(pair));
  if (res.status !== 200 || !cookie) {
    const answer = (await res.json().catch(() => null)) as { code?: string } | null;
    throw new Error(`Sign-in as ${email} refused: ${res.status} ${answer?.code ?? ""}`.trim());
  }
  return { label, headers: { Cookie: cookie } };
}

export type ProofResponse = { status: number; text: string; json: unknown };

/** One request as the session, with the Origin the CSRF check reads. */
export async function send(
  session: ProofSession,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<ProofResponse> {
  const res = await fetch(`${PROOF_BASE}${path}`, {
    method,
    headers: {
      ...session.headers,
      Origin: PROOF_BASE,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}
