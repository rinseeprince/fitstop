import { expo } from "@better-auth/expo"
import { betterAuth, type GenericEndpointContext } from "better-auth"
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api"
import { verifyPassword } from "better-auth/crypto"
import { admin, bearer } from "better-auth/plugins"
import bcrypt from "bcryptjs"
import { PostgresDialect } from "kysely"
import { after } from "next/server"
import { Pool, TypeOverrides, types } from "pg"
import {
  CLIENT_APP_SCHEME,
  LOGIN_ERROR_GOOGLE_CANCELLED,
  LOGIN_ERROR_GOOGLE_NO_ACCOUNT,
  LOGIN_ERROR_GOOGLE_NOT_LINKED,
  LOGIN_PAGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/constants"
import { captureApiError } from "@/lib/error-handler"
import { landsOnSetPassword } from "@/lib/password-link"
import { countPoolQueries } from "@/lib/perf/db-calls"
import { supabaseConnection } from "@/lib/supabase-connection"
import type * as AccountService from "@/services/account-service"
import type * as AuthEmailService from "@/services/auth-email-service"
import type { UserRole } from "@/types/auth"

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
// The Google OAuth client behind Continue with Google (D23, D29), made in
// Google Cloud Console with <BETTER_AUTH_URL>/api/auth/callback/google as an
// authorized redirect URI.
const googleClientId = requiredEnv("GOOGLE_CLIENT_ID")
const googleClientSecret = requiredEnv("GOOGLE_CLIENT_SECRET")

/** How long a request waits to reach the pooler before it fails, instead of the operating system's TCP timeout. */
const CONNECTION_TIMEOUT_MS = 10_000

/**
 * How long a connection stays open with nothing to do (D46), where pg's own
 * default is ten seconds. Opening one is a TLS handshake with the pooler,
 * several round trips, which a request after a pause would otherwise pay
 * again, in the proxy's pool and in the routes'.
 */
const IDLE_CONNECTION_MS = 5 * 60 * 1000

/**
 * How long a connection is silent before TCP checks the other end is still
 * there, and again after each further silence: one still there keeps its
 * place in a NAT, and one the pooler or a NAT dropped without a word is found
 * once a check goes unanswered and closed, usually before a request is handed
 * it (readSessionUserId reads again when one is). Under the idle limit, or no
 * check runs while a connection waits: left to the operating system, the first
 * comes after two hours. A process that is paused (a serverless instance
 * between requests) checks nothing until it runs again.
 */
const KEEP_ALIVE_AFTER_MS = 60 * 1000

// pg answers a bigint as a string. Better Auth's limiter adds its window to
// "lastRequest" (milliseconds since the epoch, exact as a number) to say when
// to retry, and on a string that sum is a concatenation.
const authTypes = new TypeOverrides()
authTypes.setTypeParser(types.builtins.INT8, (value: string) => Number(value))

/**
 * Better Auth's own connection to the database: one pool of four per bundle
 * (D28), TLS verified against Supabase's root (lib/supabase-connection.ts),
 * whose idle connections stay open five minutes under TCP keep-alive (D46).
 */
export const authPool = new Pool({
  ...supabaseConnection(databaseUrl),
  max: 4,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: IDLE_CONNECTION_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: KEEP_ALIVE_AFTER_MS,
  // An idle connection never holds a process open: a script that loads this
  // file exits when its work is done instead of waiting out the idle limit.
  // In the server, the server itself stays up.
  allowExitOnIdle: true,
  types: authTypes,
})
// A connection the pooler drops while idle is reported, not thrown: with no
// listener, pg-pool's "error" event would take the process down.
authPool.on("error", (error) => captureApiError(error, { source: "Better Auth's database pool" }))
// pg-pool listens for a connection's errors only while it sits idle. One that
// breaks in use, held by Better Auth's adapter, would throw its socket's error
// with nobody listening. The statement it breaks fails with the same error,
// which its caller reports (an endpoint of Better Auth's as a 500 its after
// hook sends to Sentry), so here it is only logged.
authPool.on("connect", (client) => {
  client.on("error", (error) => console.debug("Better Auth's database connection broke in use; the statement it broke reports it.", error))
})
// PERF_COUNT=1 in the Next server prints every statement Better Auth sends
// (CONVENTIONS §14 "Request budgets"); unset, it changes nothing.
countPoolQueries(authPool)

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
function refuseSetPasswordLandingOverHttp(ctx: GenericEndpointContext): void {
  const overHttp = ctx.request !== undefined || ctx.headers !== undefined
  const redirectTo: unknown = (ctx.body as { redirectTo?: unknown } | undefined)?.redirectTo
  if (
    ctx.path === REQUEST_PASSWORD_RESET_PATH &&
    overHttp &&
    typeof redirectTo === "string" &&
    landsOnSetPassword(redirectTo, ctx.context.baseURL)
  ) {
    throw new APIError("FORBIDDEN", { message: "The set-password link is sent by the owner's command alone." })
  }
}

/** Change email's endpoint, where Settings asks for its two emails. */
const CHANGE_EMAIL_PATH = "/change-email"

/**
 * The emailed links that hand their landing a credential, by the field each
 * endpoint takes the landing in: forgot password's link carries the token
 * that sets the password, and change email's confirmation link, opened where
 * no one is signed in, makes a session, which the Expo plugin's after hook on
 * /verify-email hands the landing as a cookie when the landing is the client
 * app's scheme.
 */
const CREDENTIAL_LINK_LANDINGS = new Map<string, "redirectTo" | "callbackURL">([
  [REQUEST_PASSWORD_RESET_PATH, "redirectTo"],
  [CHANGE_EMAIL_PATH, "callbackURL"],
])

/** Whether a landing resolves, as a browser resolves it, to a page of the app's own origin, `baseURL`'s. */
function landsOnTheApp(landing: string, baseURL: string): boolean {
  const appOrigin = new URL(baseURL).origin
  return URL.canParse(landing, appOrigin) && new URL(landing, appOrigin).origin === appOrigin
}

/**
 * A password link and change email's links land on a page of the app, never
 * on the client app's scheme, which Better Auth trusts beside the app's pages
 * (D25): on a phone where another app has claimed atletafit://, that app, not
 * the person, would be handed the token or the session the link carries.
 * Forgot password is open to anyone signed out, for any address. A landing
 * off the app's own origin is refused before any address is looked up,
 * whoever asks, the server's own calls included; the client app names a page
 * of the web app, as the site does.
 */
function refuseCredentialLinkOffTheApp(ctx: GenericEndpointContext): void {
  const field = CREDENTIAL_LINK_LANDINGS.get(ctx.path)
  const landing: unknown = field ? (ctx.body as Record<string, unknown> | undefined)?.[field] : undefined
  if (typeof landing === "string" && !landsOnTheApp(landing, ctx.context.baseURL)) {
    throw new APIError("FORBIDDEN", { message: "An emailed link lands on a page of the app." })
  }
}

/** Delete account's endpoint, where the dialog asks for the confirmation link. */
const DELETE_USER_PATH = "/delete-user"
/** Its limit: sign-in's (three in ten seconds, per IP), since it answers whether a password is right. */
export const DELETE_USER_RATE_LIMIT = { window: 10, max: 3 }

/**
 * Delete account asks for the password (rules 10 and 13, D20). Better Auth
 * checks a password only when one is sent and emails the confirmation link
 * either way, so a request without one is refused here, before any link is
 * made: a session alone, a stolen one too, never has it sent.
 */
function refuseDeleteWithoutPassword(ctx: GenericEndpointContext): void {
  const password: unknown = (ctx.body as { password?: unknown } | undefined)?.password
  if (ctx.path === DELETE_USER_PATH && (typeof password !== "string" || password === "")) {
    throw new APIError("BAD_REQUEST", { message: "Your password is required to delete your account." })
  }
}

/**
 * Better Auth's before hook: it refuses the set-password landing over HTTP,
 * a password link or change email's links landing off the app, and a
 * delete-account request without a password, and lets every other request
 * through.
 */
export const refuseBeforeEndpoint = createAuthMiddleware((ctx) => {
  refuseSetPasswordLandingOverHttp(ctx)
  refuseCredentialLinkOffTheApp(ctx)
  refuseDeleteWithoutPassword(ctx)
  return Promise.resolve()
})

/**
 * A login's password is a bcrypt hash (`$2…`) or, once set through Better
 * Auth, its scrypt (D7). Better Auth's scrypt check throws on a bcrypt hash,
 * so the hash's own prefix picks the check.
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
 * Runs one of services/auth-email-service.ts's senders, imported when a link
 * is sent, not with this module: the proxy loads this file on every request
 * and needs neither React Email nor Resend, and an email misconfiguration
 * must never take sign-in down with it. The senders report their own
 * failures; this reports the module failing to load (a missing
 * RESEND_API_KEY throws at import), as `source`, the callback's name.
 */
async function sendWithEmailService(source: string, send: (emails: typeof AuthEmailService) => Promise<void>): Promise<void> {
  try {
    await send(await import("@/services/auth-email-service"))
  } catch (error) {
    captureApiError(error, { source })
  }
}

/** The longest an address can be (a 64-character local part, the @ and a 255-character domain). */
const ADDRESS_MAX_LENGTH = 320

/** What Better Auth hands sendChangeEmailConfirmation: the asker's login, the new address and the approval's link. */
type ApprovalRequest = { user: { id: string; email: string; name: string }; newEmail: string; url: string; token: string }

/**
 * Change email's first email, "Approve your email change", to the address the
 * asker signs in with, unless the new address is held by a coach row or a
 * client row of another login, or of no login (rule 17,
 * services/account-service.ts). Better Auth sends nothing for an address a
 * login has; this sends nothing for one a row holds, or one longer than any
 * address, for which no row is read. Better Auth calls this in the background
 * once it has validated the request, read the session (the cookie's or the
 * bearer token's, as `user`), refused the address the asker has, looked for a
 * login on the new one and answered, so every answer is its own, the same for
 * an address in use and a free one; only the asker's inbox, where no approval
 * arrives, tells them apart, as it does for an address with a login. A row
 * that can't be read sends nothing and reaches Sentry.
 */
export async function sendApprovalUnlessHeld(data: ApprovalRequest): Promise<void> {
  if (data.newEmail.length > ADDRESS_MAX_LENGTH) return
  try {
    const { isAddressHeldElsewhere } = await import("@/services/account-service")
    if (await isAddressHeldElsewhere(data.newEmail, data.user.id)) return
  } catch (error) {
    captureApiError(error, { source: "sendChangeEmailConfirmation", userId: data.user.id })
    return
  }
  await sendWithEmailService("sendChangeEmailConfirmation", (emails) => emails.sendApproveEmailChangeEmail(data))
}

/** How long delete account's confirmation link lasts: one day, as its email says (rules 10 and 13). */
const DELETE_LINK_EXPIRES_IN = 60 * 60 * 24

/** What Better Auth hands sendDeleteAccountVerification: the asker's login and the confirmation link. */
type DeletionRequest = { user: { id: string; email: string; name: string }; url: string; token: string }

/**
 * Delete account's email, "Confirm deleting your account", to the address
 * the asker signs in with, worded for their role: a coach's names their
 * clients, the clients' records and logins going with it (rule 10), a
 * client's that their coach keeps nothing (rule 13). Better Auth calls this in
 * the background once it has checked the password and stored the link's
 * token. A role that can't be read, or a login with none, sends nothing and
 * reaches Sentry.
 */
export async function sendDeletionConfirmation(data: DeletionRequest): Promise<void> {
  let role: UserRole | null
  try {
    const { readLoginRole } = await import("@/services/account-service")
    role = await readLoginRole(data.user.id)
  } catch (error) {
    captureApiError(error, { source: "sendDeleteAccountVerification", userId: data.user.id })
    return
  }
  if (!role) {
    captureApiError(new Error("A login with no role asked to delete its account"), { source: "sendDeleteAccountVerification", userId: data.user.id })
    return
  }
  await sendWithEmailService("sendDeleteAccountVerification", (emails) =>
    emails.sendConfirmDeleteAccountEmail({ ...data, account: role === "trainer" ? "coach" : "client" })
  )
}

/** What a refused deletion answers on the confirmation link's page (D20): nothing was deleted, and asking again from Settings finishes it. */
export const ACCOUNT_NOT_DELETED = "Couldn't delete your account. Try again."

/**
 * Better Auth's beforeDelete: the app's records of the login go first
 * (services/account-service.ts deleteAccountRecords, which reports what
 * failed, and what it had removed, to Sentry), and Better Auth deletes the
 * login only once they have. Anything that fails refuses the deletion with
 * ACCOUNT_NOT_DELETED, the login untouched; Better Auth has already spent the
 * link's token by then, so the person asks again from Settings.
 */
export async function deleteRecordsBeforeLogin(user: { id: string }): Promise<void> {
  const refusal = () => new APIError("INTERNAL_SERVER_ERROR", { message: ACCOUNT_NOT_DELETED, code: "ACCOUNT_NOT_DELETED" })
  let accountService: typeof AccountService
  try {
    accountService = await import("@/services/account-service")
  } catch (error) {
    captureApiError(error, { source: "beforeDelete", userId: user.id })
    throw refusal()
  }
  try {
    await accountService.deleteAccountRecords(user)
  } catch {
    // Reported by deleteAccountRecords, with the keys it had removed.
    throw refusal()
  }
}

/** Better Auth's OAuth callback, where Google sends the browser back (/callback/google). */
const OAUTH_CALLBACK_PREFIX = "/callback/"

/**
 * The refusals of a Google sign-in a person meets in normal use: the two the
 * login page words (rule 8), and a person who said no on Google's page.
 */
const EXPECTED_GOOGLE_REFUSALS = new Set([LOGIN_ERROR_GOOGLE_NO_ACCOUNT, LOGIN_ERROR_GOOGLE_NOT_LINKED, LOGIN_ERROR_GOOGLE_CANCELLED])

/**
 * Better Auth answers a failed Google sign-in with a redirect to
 * /login?error=<code>, which no error handler sees (onAPIError skips
 * redirects, and a redirect is no 500). A code that is not one of the
 * expected refusals is a fault, a wrong client secret, a state that expired or
 * was used, a database read, and goes to Sentry with it, or every Google
 * sign-in could fail with nobody told.
 */
export function reportFailedGoogleSignIn(returned: unknown, endpoint: string): void {
  if (!endpoint.startsWith(OAUTH_CALLBACK_PREFIX) || !isAPIError(returned) || returned.statusCode !== 302) return
  const location = new Headers(returned.headers).get("location")
  const code = location ? new URL(location, baseURL).searchParams.get("error") : null
  if (!code || EXPECTED_GOOGLE_REFUSALS.has(code)) return
  captureApiError(new Error(`Continue with Google failed: ${code}`), { route: `/api/auth${endpoint}`, error: code })
}

/**
 * Better Auth turns an error its endpoint throws into the endpoint's answer
 * before onAPIError could see it, its own 500s included (a database fault
 * behind /get-session answers 500 FAILED_TO_GET_SESSION), and answers a failed
 * Google sign-in with a redirect. An after hook reads what the endpoint
 * returned, so those reach Sentry too; onAPIError keeps the throws that never
 * become an answer.
 */
export const reportEndpointFailure = createAuthMiddleware((ctx) => {
  reportFailedGoogleSignIn(ctx.context.returned, ctx.path)
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
  // The app's pages, and the client app's scheme (D25), bare and with Better
  // Auth's wildcard: the app signs in at these same endpoints, its requests
  // naming the scheme as their origin. Under next dev the Expo plugin adds
  // Expo Go's exp:// too.
  trustedOrigins: [appUrl, CLIENT_APP_SCHEME, `${CLIENT_APP_SCHEME}*`],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // D1, D9: no public sign-up, ever
    requireEmailVerification: true, // D4: every login is made verified
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    revokeSessionsOnPasswordReset: true, // a reset signs every other device out
    password: { verify: verifyBcryptOrScrypt },
    sendResetPassword: (data) => sendWithEmailService("sendResetPassword", (emails) => emails.sendPasswordLinkEmail(data)),
  },
  // Change email's second email, "Confirm your new email" (rule 6): Better
  // Auth sends it to the new address once the current one approved, and its
  // link is what changes the address. Each of the two links lasts an hour.
  emailVerification: {
    sendVerificationEmail: (data) => sendWithEmailService("sendVerificationEmail", (emails) => emails.sendConfirmNewEmailEmail(data)),
    expiresIn: 60 * 60,
  },
  user: {
    // A coach and a client change the email they sign in with (D18): "Approve
    // your email change" goes to the current address first, unless the new
    // address is someone else's (sendApprovalUnlessHeld). The one UPDATE that
    // changes the address changes its coach and client rows with it and
    // unlinks its Google accounts (the trigger, migrations 210 and 213).
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: sendApprovalUnlessHeld,
    },
    // Delete account (rules 10 and 13, D20): the password, then an emailed
    // link, opened where the person is signed in (a browser's cookie, or the
    // client app requesting it with its bearer token), which deletes the
    // app's records first (beforeDelete) and then the login.
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: sendDeletionConfirmation,
      deleteTokenExpiresIn: DELETE_LINK_EXPIRES_IN,
      beforeDelete: deleteRecordsBeforeLogin,
    },
  },
  // Continue with Google, for sign-in only (rule 8, D3, D23): coaches and
  // clients alike sign in to the login that has their Google address, and
  // Google never makes one. A Google address with no login lands on
  // /login?error=signup_disabled. Google's account chooser shows every time,
  // so a shared browser never signs in as whoever used Google last. The
  // override stays off: on, every Google sign-in would rewrite the login's
  // address to the Google account's, skipping change email's check and both
  // its emails (rule 17).
  socialProviders: {
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      disableSignUp: true,
      prompt: "select_account",
      overrideUserInfoOnSignIn: false,
    },
  },
  // A Google sign-in finds its login by the Google account first, then by
  // address. By address, Better Auth links it only when Google says it has
  // verified that the address is the account's and the login's is verified
  // (D4). No trusted provider: a trusted Google is linked even when Google
  // hasn't verified the address, so someone who made a Google account on
  // another person's address would sign in as them. Linking never changes a
  // login's address, and a link lasts until the address changes: the UPDATE
  // that changes it deletes the login's Google links (migration 213).
  account: { accountLinking: { enabled: true } },
  // Linking and unlinking a Google account by hand answer 404: no screen
  // offers them, and Google is for sign-in only (D23). link-social keeps the
  // address it was started on until Google sends the browser back, and that
  // return checks no session, so a link begun before the owner's
  // auth:move-email could be finished after it, on the moved login.
  // The Expo plugin's Google proxy answers 404 too, until the client app's
  // Continue with Google is built: whatever browser opens its link stores the
  // Google sign-in the link names, so an attacker could finish their own
  // sign-in in someone else's browser and leave it signed in as them.
  disabledPaths: ["/link-social", "/unlink-account", "/expo-authorization-proxy"],
  // Better Auth's defaults, written down: a session lasts seven days from its
  // last renewal, and a use a day or more after that renews it. No cookie
  // cache, so a revoked session ends on its next request (D15).
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  // Better Auth's limiter on /api/auth, counted in better_auth."rateLimit":
  // on in production, off under next dev (D16). Delete account checks a
  // password, so it gets sign-in's three tries in ten seconds: Better Auth's
  // own rule for it is its general hundred.
  rateLimit: { storage: "database", customRules: { [DELETE_USER_PATH]: DELETE_USER_RATE_LIMIT } },
  databaseHooks: {
    user: { create: { before: refuseUnlessOwnerOrInvite } },
  },
  hooks: { before: refuseBeforeEndpoint, after: reportEndpointFailure },
  // A Google sign-in that fails before the button's own errorCallbackURL is
  // known (a state that expired or was used, a database read) lands on the
  // login page with its error too, never on Better Auth's own error page.
  onAPIError: { onError: (error) => reportUnexpectedAuthError(error), errorURL: LOGIN_PAGE },
  // The database makes every new id (uuid, gen_random_uuid()), and a copied
  // login kept its Supabase one: every login's id has the type of the user_id
  // columns that point at it. A read Better Auth makes with the rows it needs
  // beside it is one query, a join (D46): a session with its login, which
  // every request reads, a login with its accounts at sign-in and forgot
  // password, and a Google account with its login.
  advanced: { database: { generateId: "uuid", joins: true }, backgroundTasks: { handler: runAfterAnswer } },
  // bearer(): every answer that sets the session cookie carries its value in
  // set-auth-token too, and Authorization: Bearer <that value> is that session
  // wherever a session is read. expo(): the plugin's client in the app names
  // the app's origin in expo-origin, which stands in for the Origin a phone's
  // fetch doesn't send, and a sign-in or change email's link landing on the
  // scheme is handed the session in its address (held off here: Google's
  // proxy is off above, and the before hook keeps emailed links on the app).
  plugins: [admin({ adminUserIds }), bearer(), expo()],
  telemetry: { enabled: false },
})

/**
 * Who a request is signed in as: the user id of the live session its cookie,
 * or its bearer token (the bearer plugin), names; null for none. The proxy,
 * the auth seam and GET /api/auth/me ask here.
 *
 * The read never renews the session (disableRefresh). A renewal moves the
 * session's expiry and answers with a new cookie, which only Better Auth's own
 * endpoints hand back, GET /api/auth/get-session among them, which the
 * browser's useSession() calls. Renewed here, the row's expiry would move
 * while the browser kept a cookie set to lapse a week after sign-in, and
 * someone using the app every day would be signed out at the week's end.
 *
 * A read Better Auth answers with its own 500 (a database fault) is read once
 * more: a connection can break while it sits in the pool, where one stays five
 * minutes (D46), and the read handed it fails as the pool drops it, so the
 * second read takes another. Throws when the session still cannot be read,
 * and the caller treats the request as signed out. Every fault reaches Sentry
 * once: each of Better Auth's own 500s through the after hook, and here a
 * throw from before its endpoint ran (its schema check, when a fresh instance
 * cannot reach the database), which no hook sees and which is not read again.
 */
export async function readSessionUserId(headers: Headers): Promise<string | null> {
  try {
    try {
      return await sessionUserIdOnce(headers)
    } catch (failed) {
      if (!isAPIError(failed) || failed.statusCode < 500) throw failed
      return await sessionUserIdOnce(headers)
    }
  } catch (error) {
    if (!isAPIError(error)) captureApiError(error, { source: "readSessionUserId" })
    throw error
  }
}

/** The user id of the session the headers name, read once, never renewing it. */
async function sessionUserIdOnce(headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers, query: { disableRefresh: true } })
  return session?.user.id ?? null
}
