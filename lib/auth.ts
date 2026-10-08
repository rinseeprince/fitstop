import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api"
import { verifyPassword } from "better-auth/crypto"
import { admin, bearer } from "better-auth/plugins"
import bcrypt from "bcryptjs"
import { PostgresDialect } from "kysely"
import { after } from "next/server"
import { Pool, TypeOverrides, types } from "pg"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants"
import { captureApiError } from "@/lib/error-handler"
import { landsOnSetPassword } from "@/lib/password-link"
import { supabaseConnection } from "@/lib/supabase-connection"

/**
 * Better Auth, the one betterAuth(...) in the tree (docs/BETTER-AUTH-PLAN.md
 * 2.2). Every sign-in runs on it: it answers under /api/auth
 * (app/api/auth/[...all]/route.ts), the proxy and the auth seam read its
 * session (readSessionUserId), and it keeps its logins in schema better_auth
 * (migration 208), whose ids are the user_id that profiles, coaches and
 * clients point at (migration 209).
 */

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}: Better Auth (lib/auth.ts) cannot start without it.`)
  }
  return value
}

// Supabase's transaction pooler string for the postgres user (D28), as the
// dashboard gives it. postgres owns schema better_auth, so RLS never binds
// Better Auth, and the Data API never serves the schema.
const databaseUrl = requiredEnv("DATABASE_URL")
// Signs the session cookie and the bearer token. Required here: outside
// production Better Auth would fall back to its public default secret.
const secret = requiredEnv("BETTER_AUTH_SECRET")
// Where Better Auth answers: the links it builds, and whether its cookies
// carry the __Secure- prefix (https only).
const baseURL = requiredEnv("BETTER_AUTH_URL")
// The app's own address: the one origin trusted to post to /api/auth with a cookie.
const appUrl = requiredEnv("NEXT_PUBLIC_APP_URL")
// One address (D29): Better Auth's links and cookies must agree with the app's.
if (new URL(baseURL).origin !== new URL(appUrl).origin) {
  throw new Error("BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL must name the same origin.")
}
// The owner's user id, comma-separated (D24): the admin plugin's admins, for
// the admin endpoints that need a session. Empty until the owner sets it.
const adminUserIds = (process.env.AUTH_ADMIN_USER_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean)

/** How long a request waits to reach the pooler before it fails, instead of the operating system's TCP timeout. */
const CONNECTION_TIMEOUT_MS = 10_000

// pg answers a bigint as a string. Better Auth's limiter adds its window to
// "lastRequest" (milliseconds since the epoch, exact as a number) to say when
// to retry, and on a string that sum is a concatenation.
const authTypes = new TypeOverrides()
authTypes.setTypeParser(types.builtins.INT8, (value: string) => Number(value))

/**
 * Better Auth's own connection to the database: one pool of four per bundle
 * (D28), TLS verified against Supabase's root (lib/supabase-connection.ts).
 */
export const authPool = new Pool({
  ...supabaseConnection(databaseUrl),
  max: 4,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  types: authTypes,
})
// A connection the pooler drops while idle is reported, not thrown: with no
// listener, pg-pool's "error" event would take the process down.
authPool.on("error", (error) => captureApiError(error, { source: "Better Auth's database pool" }))

/** The admin plugin's create-user endpoint: the one path that may make a login (D9). */
const CREATE_USER_PATH = "/admin/create-user"

/**
 * The guard on every login Better Auth would make (D9). Only the admin
 * plugin's create-user, which the owner's coach:create and the client invite
 * call on the server, may make one: public sign-up is off, and this refuses
 * every other path too (a Google sign-up, a plugin's), and a write made outside
 * any endpoint. Migration 208's copy is SQL and never meets it.
 */
export function refuseUnlessOwnerOrInvite(_user: unknown, ctx: { path?: string } | null): Promise<void> {
  if (ctx?.path === CREATE_USER_PATH) return Promise.resolve()
  return Promise.reject(new APIError("FORBIDDEN", { message: "Accounts are created by invitation." }))
}

/** Forgot password's endpoint: where a password link is asked for over HTTP. */
const REQUEST_PASSWORD_RESET_PATH = "/request-password-reset"

/**
 * The "Set your password" link is the owner's (D17, rule 9): only the
 * server's own call, createCoachLogin's, which carries no request, may ask for
 * a password link landing on /set-password. Over HTTP the endpoint is forgot
 * password's, open to anyone signed out, and its origin check lets any page
 * of the app be the landing, so without this anyone could send any address
 * with a login the new-coach email. A request asking for that landing is
 * refused before any address is looked up: every address gets one answer.
 */
export const refuseSetPasswordLandingOverHttp = createAuthMiddleware((ctx) => {
  const overHttp = ctx.request !== undefined || ctx.headers !== undefined
  const redirectTo: unknown = (ctx.body as { redirectTo?: unknown } | undefined)?.redirectTo
  if (
    ctx.path === REQUEST_PASSWORD_RESET_PATH &&
    overHttp &&
    typeof redirectTo === "string" &&
    landsOnSetPassword(redirectTo, ctx.context.baseURL)
  ) {
    return Promise.reject(new APIError("FORBIDDEN", { message: "The set-password link is sent by the owner's command alone." }))
  }
  return Promise.resolve()
})

/**
 * Today's logins carry Supabase's bcrypt hashes, copied by migration 208; a
 * password set through Better Auth is its scrypt (D7). Better Auth's scrypt
 * check throws on a bcrypt hash, so the hash's own prefix picks the check.
 * Hashing stays Better Auth's: every new password is scrypt.
 */
export function verifyBcryptOrScrypt({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  return hash.startsWith("$2") ? bcrypt.compare(password, hash) : verifyPassword({ hash, password })
}

/**
 * Better Auth answers every error on /api/auth itself. A refusal (a wrong
 * password, a refused origin, a 429) is an answer; anything else (a 500, a
 * throw that is not Better Auth's own) also goes to Sentry, as every server
 * error does (CONVENTIONS §12).
 */
export function reportUnexpectedAuthError(error: unknown, endpoint = ""): void {
  if (isAPIError(error) && error.statusCode < 500) return
  captureApiError(error, { route: `/api/auth${endpoint}` })
}

/**
 * Better Auth's background work, its emails among it, runs after the answer
 * has gone out. Forgot password then answers an address with an account as
 * fast as one without, so its timing tells nobody which addresses have one.
 * In a request, Next's after() keeps the work alive past the answer; outside
 * one (a script) after() refuses, and the work, already running, runs on and
 * is kept for backgroundWorkSettled.
 */
export function runAfterAnswer(task: Promise<unknown>): void {
  try {
    after(task)
  } catch (refusal) {
    console.debug("Better Auth background task outside a request: it runs on.", refusal)
    outsideRequest.add(task)
    void task.finally(() => outsideRequest.delete(task))
  }
}

/** Background work started outside a request, which no after() keeps alive. */
const outsideRequest = new Set<Promise<unknown>>()

/**
 * Settles when every piece of Better Auth's background work started outside
 * a request has: a script that makes a login awaits it before it exits, or the
 * email the login asked for may be cut off mid-send.
 */
export async function backgroundWorkSettled(): Promise<void> {
  await Promise.allSettled([...outsideRequest])
}

/**
 * Better Auth turns an error its endpoint throws into the endpoint's answer
 * before onAPIError could see it, its own 500s included (a database fault
 * behind /get-session answers 500 FAILED_TO_GET_SESSION). An after hook reads
 * what the endpoint returned, so those reach Sentry too; onAPIError keeps the
 * throws that never become an answer.
 */
export const reportEndpointFailure = createAuthMiddleware((ctx) => {
  if (isAPIError(ctx.context.returned)) reportUnexpectedAuthError(ctx.context.returned, ctx.path)
  return Promise.resolve()
})

export const auth = betterAuth({
  baseURL,
  secret,
  // The dialect form is the one that takes schemaName. Better Auth runs the
  // writes it groups (a one-time token's use and the tokens it clears with
  // it) in one transaction only when asked to.
  database: {
    dialect: new PostgresDialect({ pool: authPool }),
    type: "postgres",
    schemaName: "better_auth",
    transaction: true,
  },
  trustedOrigins: [appUrl],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // D1, D9: no public sign-up, ever
    requireEmailVerification: true, // D4: every copied login is born verified
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    revokeSessionsOnPasswordReset: true, // a reset signs every other device out
    password: { verify: verifyBcryptOrScrypt },
    // Imported when a link is sent, not with this module: the proxy loads
    // this file on every request and needs neither React Email nor Resend,
    // and an email misconfiguration must never take sign-in down with it.
    sendResetPassword: async (data) => {
      try {
        const { sendPasswordLinkEmail } = await import("@/services/auth-email-service")
        await sendPasswordLinkEmail(data)
      } catch (error) {
        // The send reports its own failures; this is the module failing to
        // load (a missing RESEND_API_KEY throws at import).
        captureApiError(error, { source: "sendResetPassword" })
      }
    },
  },
  // Better Auth's defaults, written down: a session lasts seven days from its
  // last renewal, and a use a day or more after that renews it. No cookie
  // cache, so a revoked session ends on its next request (D15).
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  // Better Auth's limiter on /api/auth, counted in better_auth."rateLimit":
  // on in production, off under next dev (D16).
  rateLimit: { storage: "database" },
  databaseHooks: {
    user: { create: { before: refuseUnlessOwnerOrInvite } },
  },
  hooks: { before: refuseSetPasswordLandingOverHttp, after: reportEndpointFailure },
  onAPIError: { onError: (error) => reportUnexpectedAuthError(error) },
  // The database makes every new id (uuid, gen_random_uuid()), and a copied
  // login kept its Supabase one: every login's id has the type of the user_id
  // columns that point at it.
  advanced: { database: { generateId: "uuid" }, backgroundTasks: { handler: runAfterAnswer } },
  plugins: [admin({ adminUserIds }), bearer()],
  telemetry: { enabled: false },
})

/**
 * Who a request is signed in as: the user id of the live session its cookie,
 * or its bearer token (the bearer plugin), names; null for none. The proxy,
 * the auth seam and GET /api/auth/me ask here.
 *
 * The read never renews the session (disableRefresh). A renewal moves the
 * session's expiry and answers with a new cookie, and only Better Auth's own
 * GET /api/auth/get-session, which the browser's useSession() calls, hands
 * that cookie back. Renewed here, the row's expiry would move while the
 * browser kept a cookie set to lapse a week after sign-in, and someone using
 * the app every day would be signed out at the week's end.
 *
 * Throws when the session cannot be read (a database fault), and the caller
 * treats the request as signed out. Every such fault reaches Sentry once:
 * Better Auth's own 500 through the after hook, and here a throw from before
 * its endpoint ran (its schema check, when a fresh instance cannot reach the
 * database), which no hook sees.
 */
export async function readSessionUserId(headers: Headers): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers, query: { disableRefresh: true } })
    return session?.user.id ?? null
  } catch (error) {
    if (!isAPIError(error)) captureApiError(error, { source: "readSessionUserId" })
    throw error
  }
}
