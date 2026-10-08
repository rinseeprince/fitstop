/**
 * Real sessions for the request-level proof scripts, and the request helper
 * every proof uses against a running `next dev` (D34): the one the proof
 * starts for itself (scripts/proof-server.ts), or WIRE_PROOF_BASE's.
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
import { parseDatabaseUrl, supabaseConnection } from "@/lib/supabase-connection";

/** Production's project ref: no proof, seed or fixture writes there. */
export const PROD_REF = "etezzztgafcotyahgijk";

/**
 * The app the request helpers drive: the next dev the proof started for its
 * run (startProofServer, scripts/proof-server.ts, points them there), else
 * WIRE_PROOF_BASE, else :3000.
 */
export let PROOF_BASE = process.env.WIRE_PROOF_BASE ?? "http://localhost:3000";

/** Points every request helper at the app this run drives. */
export function setProofBase(base: string): void {
  PROOF_BASE = base;
}

/** A session the proofs drive the app as, by the header that carries it: Authorization (minted) or Cookie (signed in). */
export type ProofSession = { label: string; headers: Record<string, string> };

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

/**
 * The scripts reach one project through two connections: NEXT_PUBLIC_SUPABASE_URL
 * (the app's rows, supabaseAdmin) and DATABASE_URL (Better Auth's logins and
 * sessions). Refuses unless both name the same project, and that project is
 * not production: a session or a login written into another project than the
 * rows it belongs to would be a stray credential there.
 */
export function assertOneProject(): void {
  const supabaseRef = new URL(need("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0];
  const databaseUser = parseDatabaseUrl(need("DATABASE_URL")).username;
  if (databaseUser !== `postgres.${supabaseRef}`) {
    throw new Error(`Refused: DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL name different projects (${databaseUser}, ${supabaseRef}).`);
  }
  if (supabaseRef === PROD_REF) throw new Error("Refused: the scripts write no session or login on production.");
}

/** One statement through Better Auth's own connection (the postgres user through the pooler, TLS verified). */
async function sql<T>(text: string, values: unknown[]): Promise<T[]> {
  assertOneProject();
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

/** Every token this process minted and has not ended, for endMintedSessions. */
const minted = new Set<string>();

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
  minted.add(token);
  return { label, headers: { Authorization: `Bearer ${token}` } };
}

/** Ends a minted session: its row goes, so its token opens nothing. */
export async function endSession(session: ProofSession): Promise<void> {
  const bearer = session.headers.Authorization;
  if (!bearer) return;
  const token = bearer.slice("Bearer ".length);
  await sql(`DELETE FROM better_auth.session WHERE token = $1`, [token]);
  minted.delete(token);
}

/**
 * Ends every session this process minted, in one statement: a proof's
 * cleanup calls it in its finally, so no minted row outlives the run, a real
 * login's least of all. Returns how many rows went.
 */
export async function endMintedSessions(): Promise<number> {
  if (minted.size === 0) return 0;
  const rows = await sql<{ token: string }>(`DELETE FROM better_auth.session WHERE token = ANY($1) RETURNING token`, [[...minted]]);
  minted.clear();
  return rows.length;
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

/** The proxy's answer to an /api request with no session (docs/BETTER-AUTH-PLAN.md rule 16). */
export const UNAUTHORIZED_TEXT = JSON.stringify({ success: false, error: "Unauthorized" });

/**
 * One request with no session. `refused` holds when the proxy answered it
 * with its 401 JSON before any route ran — never the login page.
 */
export async function sendSignedOut(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ refused: boolean; status: number; text: string }> {
  const res = await fetch(`${PROOF_BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { Origin: PROOF_BASE, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    refused: res.status === 401 && text === UNAUTHORIZED_TEXT && res.headers.get("location") === null,
    status: res.status,
    text: text.slice(0, 160),
  };
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
