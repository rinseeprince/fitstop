import { betterAuth } from "better-auth"
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api"
import { verifyPassword } from "better-auth/crypto"
import { admin, bearer } from "better-auth/plugins"
import bcrypt from "bcryptjs"
import { PostgresDialect } from "kysely"
import { Pool, TypeOverrides, types } from "pg"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants"
import { captureApiError } from "@/lib/error-handler"
import { supabaseConnection } from "@/lib/supabase-connection"

/**
 * Better Auth, the one betterAuth(...) in the tree (docs/BETTER-AUTH-PLAN.md
 * 2.2). It answers under /api/auth (app/api/auth/[...all]/route.ts) and keeps
 * its logins in schema better_auth (migration 208), on the user ids profiles,
 * coaches and clients carry. No screen signs in through it: every sign-in
 * runs on Supabase Auth.
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
  hooks: { after: reportEndpointFailure },
  onAPIError: { onError: (error) => reportUnexpectedAuthError(error) },
  // The database makes every new id (uuid, gen_random_uuid()), and a copied
  // login kept its Supabase one: every login's id has the type of the user_id
  // columns that point at it.
  advanced: { database: { generateId: "uuid" } },
  plugins: [admin({ adminUserIds }), bearer()],
  telemetry: { enabled: false },
})
