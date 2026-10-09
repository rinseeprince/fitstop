// @vitest-environment node
import { describe, it, expect, vi, afterAll, afterEach, beforeEach } from "vitest"
import { createHash } from "node:crypto"
import bcrypt from "bcryptjs"
import type { BetterAuthOptions } from "better-auth"
import { hashPassword } from "better-auth/crypto"
import { memoryAdapter } from "better-auth/adapters/memory"

/**
 * lib/auth.ts's rules and the options it hands Better Auth: the guard on
 * making a login (D9), the two-way password check (D7), its connection to the
 * database, its refusals at start-up, what reaches Sentry, and the Account
 * cards' changes (change password, change email, sign out everywhere).
 *
 * lib/auth.ts builds its pool and Better Auth at import. The constructor is
 * stubbed to keep the options it was given, so nothing connects; the pipeline
 * tests then run the REAL Better Auth over its memory adapter with exactly
 * those options, so a rule proven here is proven as Better Auth calls it.
 */
const ENV = vi.hoisted(() => ({
  DATABASE_URL: "postgresql://postgres.test:secret@localhost:6543/postgres",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
}))
vi.hoisted(() => {
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value)
})
vi.mock("better-auth", () => ({ betterAuth: vi.fn((options: unknown) => ({ options })) }))
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }))
vi.mock("@/services/auth-email-service", () => ({
  sendPasswordLinkEmail: vi.fn(),
  sendApproveEmailChangeEmail: vi.fn(),
  sendConfirmNewEmailEmail: vi.fn(),
  sendConfirmDeleteAccountEmail: vi.fn(),
}))
// The app's rows behind Better Auth's hooks: services/account-service.test.ts proves the statements.
vi.mock("@/services/account-service", () => ({ isAddressHeldElsewhere: vi.fn(), readLoginRole: vi.fn(), deleteAccountRecords: vi.fn() }))
// Better Auth's background work goes to Next's after(), which keeps it alive
// past the answer; here it only records the work, which runs on regardless.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }))

import { APIError } from "better-auth/api"
import {
  ACCOUNT_NOT_DELETED,
  auth,
  authPool,
  backgroundWorkSettled,
  deleteRecordsBeforeLogin,
  readSessionUserId,
  runAfterAnswer,
  refuseBeforeEndpoint,
  refuseUnlessOwnerOrInvite,
  reportEndpointFailure,
  reportUnexpectedAuthError,
  sendDeletionConfirmation,
  verifyBcryptOrScrypt,
} from "./auth"
import { captureApiError } from "@/lib/error-handler"
import {
  sendApproveEmailChangeEmail,
  sendConfirmDeleteAccountEmail,
  sendConfirmNewEmailEmail,
  sendPasswordLinkEmail,
} from "@/services/auth-email-service"
import { deleteAccountRecords, isAddressHeldElsewhere, readLoginRole } from "@/services/account-service"
import { after } from "next/server"

/** Every piece of background work handed to after() so far, settled. */
const backgroundSettled = () => Promise.all(vi.mocked(after).mock.calls.map(([task]) => task as Promise<unknown>))
import {
  ACCOUNT_DELETED_PAGE,
  CLIENT_APP_SCHEME,
  LOGIN_ERROR_GOOGLE_NO_ACCOUNT,
  LOGIN_ERROR_GOOGLE_NOT_LINKED,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/constants"
import { SUPABASE_ROOT_CA } from "@/lib/supabase-connection"

/** What lib/auth.ts handed Better Auth, read as Better Auth's own option type. */
const options: BetterAuthOptions = auth.options

type Row = Record<string, unknown>

/**
 * The real Better Auth with lib/auth.ts's options, its rows in memory; email
 * and password, and the social providers, may be swapped. Under NODE_ENV=test
 * Better Auth skips its origin check unless told not to; `originCheck` runs
 * it, as the server always does.
 */
async function liveAuth(
  emailAndPassword?: BetterAuthOptions["emailAndPassword"],
  db: Record<string, Row[]> = { user: [], session: [], account: [], verification: [], rateLimit: [] },
  {
    originCheck = false,
    rateLimited = false,
    socialProviders,
  }: { originCheck?: boolean; rateLimited?: boolean; socialProviders?: BetterAuthOptions["socialProviders"] } = {}
) {
  const { betterAuth } = await vi.importActual<typeof import("better-auth")>("better-auth")
  const instance = betterAuth({
    ...auth.options,
    database: memoryAdapter(db),
    emailAndPassword: emailAndPassword ?? auth.options.emailAndPassword,
    advanced: { ...auth.options.advanced, ...(originCheck ? { disableOriginCheck: false } : {}) },
    // The limiter runs in production only; rateLimited switches it on, its rules as lib/auth.ts wrote them.
    ...(rateLimited ? { rateLimit: { ...auth.options.rateLimit, enabled: true, storage: "memory" as const } } : {}),
    socialProviders: socialProviders ?? auth.options.socialProviders,
  })
  return { instance, db }
}

/** A login with a password credential, as migration 208 copies one in. */
function seedLogin(db: Record<string, Row[]>, email: string, hash: string, emailVerified = true) {
  const id = crypto.randomUUID()
  const now = new Date()
  db.user.push({ id, name: "Proof", email, emailVerified, createdAt: now, updatedAt: now, banned: false })
  db.account.push({ id: crypto.randomUUID(), userId: id, accountId: id, providerId: "credential", password: hash, createdAt: now, updatedAt: now })
  return id
}

const PASSWORD = "correct horse battery"
const WRONG = "correct horse battery!"

afterAll(async () => {
  vi.unstubAllEnvs()
  await authPool.end()
})

describe("the guard on making a login (D9)", () => {
  it("lets the admin plugin's create-user make one", async () => {
    await expect(refuseUnlessOwnerOrInvite({}, { path: "/admin/create-user" })).resolves.toBeUndefined()
  })

  it.each([
    ["sign-up", { path: "/sign-up/email" }],
    ["a Google sign-up", { path: "/callback/:id" }],
    ["a social sign-in", { path: "/sign-in/social" }],
    ["a path that only starts like create-user", { path: "/admin/create-user-now" }],
    ["an endpoint with no path", {}],
    ["a write made outside any endpoint", null],
  ])("refuses %s", async (_label, ctx) => {
    await expect(refuseUnlessOwnerOrInvite({}, ctx)).rejects.toMatchObject({
      status: "FORBIDDEN",
      statusCode: 403,
      message: "Accounts are created by invitation.",
    })
  })

  it("is the hook Better Auth runs before every login it makes, with public sign-up off", () => {
    expect(options.databaseHooks?.user?.create?.before).toBe(refuseUnlessOwnerOrInvite)
    expect(options.emailAndPassword?.disableSignUp).toBe(true)
  })

  it("in Better Auth's pipeline: sign-up is refused and nothing is made", async () => {
    const { instance, db } = await liveAuth()
    await expect(
      instance.api.signUpEmail({ body: { email: "new@example.com", password: PASSWORD, name: "New" } })
    ).rejects.toMatchObject({ body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" } })
    expect(db.user).toEqual([])
  })

  it("in Better Auth's pipeline: with sign-up switched on, the guard alone refuses it and nothing is made", async () => {
    const { instance, db } = await liveAuth({ ...options.emailAndPassword, enabled: true, disableSignUp: false })
    // With requireEmailVerification on, sign-up answers a refused creation with
    // the generic answer it gives a taken address, so no response tells who has
    // an account: what proves the refusal is that no row was written.
    const answer = await instance.api.signUpEmail({ body: { email: "new@example.com", password: PASSWORD, name: "New" } })
    expect(answer.token).toBeNull()
    expect(db.user).toEqual([])
    expect(db.account).toEqual([])
  })

  it("in Better Auth's pipeline: the admin plugin's create-user, called on the server, makes the login", async () => {
    const { instance, db } = await liveAuth()
    const made = await instance.api.createUser({ body: { email: "Coach@Example.com", name: "Coach", data: { emailVerified: true } } })
    expect(made.user.email).toBe("coach@example.com")
    expect(db.user).toHaveLength(1)
    expect(db.user[0]).toMatchObject({ email: "coach@example.com", emailVerified: true })
  })
})

describe("the two-way password check (D7)", () => {
  // A stored bcrypt hash may carry $2a$; bcryptjs writes $2b$, the same
  // algorithm under the newer prefix.
  const bcryptHash = bcrypt.hashSync(PASSWORD, 10).replace(/^\$2b\$/, "$2a$")

  it("checks a bcrypt hash with bcrypt", async () => {
    expect(bcryptHash.startsWith("$2a$10$")).toBe(true)
    await expect(verifyBcryptOrScrypt({ hash: bcryptHash, password: PASSWORD })).resolves.toBe(true)
    await expect(verifyBcryptOrScrypt({ hash: bcryptHash, password: WRONG })).resolves.toBe(false)
  })

  it("checks a password set through Better Auth with its scrypt", async () => {
    const scryptHash = await hashPassword(PASSWORD)
    expect(scryptHash.startsWith("$")).toBe(false)
    await expect(verifyBcryptOrScrypt({ hash: scryptHash, password: PASSWORD })).resolves.toBe(true)
    await expect(verifyBcryptOrScrypt({ hash: scryptHash, password: WRONG })).resolves.toBe(false)
  })

  it("is Better Auth's check, and hashing stays Better Auth's own", () => {
    expect(options.emailAndPassword?.password?.verify).toBe(verifyBcryptOrScrypt)
    expect(options.emailAndPassword?.password?.hash).toBeUndefined()
  })

  it.each([
    ["a bcrypt hash", () => Promise.resolve(bcryptHash)],
    ["a Better Auth hash", () => hashPassword(PASSWORD)],
  ])("in Better Auth's pipeline: sign-in works with %s and refuses the wrong password", async (_label, makeHash) => {
    const { instance, db } = await liveAuth()
    const id = seedLogin(db, "client@example.com", await makeHash())
    const signedIn = await instance.api.signInEmail({ body: { email: "client@example.com", password: PASSWORD } })
    expect(signedIn.user.id).toBe(id)
    expect(db.session).toHaveLength(1)
    await expect(
      instance.api.signInEmail({ body: { email: "client@example.com", password: WRONG } })
    ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } })
  })

  it("in Better Auth's pipeline: an unverified address is refused even with the right password (D4)", async () => {
    const { instance, db } = await liveAuth()
    seedLogin(db, "unverified@example.com", bcryptHash, false)
    await expect(
      instance.api.signInEmail({ body: { email: "unverified@example.com", password: PASSWORD } })
    ).rejects.toMatchObject({ status: "FORBIDDEN", body: { code: "EMAIL_NOT_VERIFIED" } })
    expect(db.session).toEqual([])
  })
})

/** lib/auth.ts imported afresh with one variable changed; the stub is put back after. */
async function importWith(name: keyof typeof ENV, value: string) {
  vi.resetModules()
  vi.stubEnv(name, value)
  try {
    return await import("./auth")
  } finally {
    vi.stubEnv(name, ENV[name])
  }
}

describe("its connection to the database", () => {
  it("is Supabase's pooler, TLS verified against Supabase's root, four connections, a ten-second wait to connect", () => {
    expect(authPool.options).toMatchObject({
      connectionString: ENV.DATABASE_URL,
      max: 4,
      connectionTimeoutMillis: 10_000,
      ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    })
  })

  it("reads a bigint as a number, so the limiter's time to retry is a sum, not a concatenation", () => {
    const parse = authPool.options.types?.getTypeParser(20, "text")
    expect(parse?.("1791398038821")).toBe(1791398038821)
  })

  it("reports a connection the pooler drops while idle, and does not throw it", () => {
    vi.mocked(captureApiError).mockClear()
    const dropped = new Error("Connection terminated unexpectedly")
    expect(authPool.listenerCount("error")).toBe(1)
    expect(() => authPool.emit("error", dropped, {} as never)).not.toThrow()
    expect(captureApiError).toHaveBeenCalledWith(dropped, { source: "Better Auth's database pool" })
  })

  it("holds every password to the shared lengths", () => {
    expect(options.emailAndPassword).toMatchObject({ minPasswordLength: PASSWORD_MIN_LENGTH, maxPasswordLength: PASSWORD_MAX_LENGTH })
  })
})

describe("it refuses to start", () => {
  it.each(Object.keys(ENV) as Array<keyof typeof ENV>)("without %s", async (name) => {
    await expect(importWith(name, "")).rejects.toThrow(`Missing ${name}`)
  })

  it("on a DATABASE_URL carrying a parameter, which pg would let replace the TLS setting", async () => {
    await expect(importWith("DATABASE_URL", `${ENV.DATABASE_URL}?sslmode=disable`)).rejects.toThrow(
      "DATABASE_URL must be the pooler string with no parameters"
    )
  })

  it("when BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL name different origins", async () => {
    await expect(importWith("NEXT_PUBLIC_APP_URL", "http://localhost:3001")).rejects.toThrow("must name the same origin")
  })
})

describe("what reaches Sentry", () => {
  it("not a refusal: a wrong password, a refused origin, a 429", () => {
    vi.mocked(captureApiError).mockClear()
    reportUnexpectedAuthError(new APIError("UNAUTHORIZED", { message: "Invalid email or password" }))
    reportUnexpectedAuthError(new APIError("FORBIDDEN", { message: "Invalid origin" }))
    reportUnexpectedAuthError(new APIError("TOO_MANY_REQUESTS"))
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it("a 500, and any throw that is not Better Auth's own", () => {
    vi.mocked(captureApiError).mockClear()
    const fault = new APIError("INTERNAL_SERVER_ERROR", { message: "Failed to create session" })
    const crash = new Error('relation "better_auth.session" does not exist')
    reportUnexpectedAuthError(fault)
    reportUnexpectedAuthError(crash)
    expect(captureApiError).toHaveBeenCalledWith(fault, { route: "/api/auth" })
    expect(captureApiError).toHaveBeenCalledWith(crash, { route: "/api/auth" })
  })

  it("is Better Auth's error handler and its after hook", () => {
    vi.mocked(captureApiError).mockClear()
    const crash = new Error("pooler unreachable")
    void options.onAPIError?.onError?.(crash, {} as never)
    expect(captureApiError).toHaveBeenCalledWith(crash, { route: "/api/auth" })
    expect(options.hooks?.after).toBe(reportEndpointFailure)
  })

  /** A sign-in through Better Auth's own HTTP handler, as the route serves it. */
  const signIn = (instance: { handler: (request: Request) => Promise<Response> }, password: string, headers: Record<string, string> = {}) =>
    instance.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ email: "client@example.com", password }),
      })
    )

  it("in Better Auth's pipeline: a sign-in posted with a cookie from another site is refused and reaches no one", async () => {
    vi.mocked(captureApiError).mockClear()
    const { instance, db } = await liveAuth(undefined, undefined, { originCheck: true })
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const refused = await signIn(instance, PASSWORD, { cookie: "visitor=1", origin: "https://evil.example" })
    expect(refused.status).toBe(403)
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: a 500 its endpoint answers itself, a database fault behind get-session, reaches Sentry once", async () => {
    vi.mocked(captureApiError).mockClear()
    const { instance, db } = await liveAuth()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const signedIn = await signIn(instance, PASSWORD)
    const cookie = signedIn.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="))?.split(";")[0]
    expect(cookie).toBeDefined()
    // The store fails every read of its sessions, as a database outage would.
    db.session = new Proxy([], {
      get() {
        throw new Error("database fault")
      },
    }) as unknown as Row[]
    const session = await instance.handler(new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie: cookie! } }))
    expect(session.status).toBe(500)
    expect(captureApiError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(captureApiError).mock.calls[0]?.[1]).toEqual({ route: "/api/auth/get-session" })
  })

  it("in Better Auth's pipeline: a throw from below it, a failing session write, reaches Sentry once", async () => {
    vi.mocked(captureApiError).mockClear()
    const { instance, db } = await liveAuth()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    // The store refuses the session's write: the sign-in throws, as a database fault would.
    db.session = Object.freeze([]) as unknown as Row[]
    expect((await signIn(instance, PASSWORD)).status).toBe(500)
    expect(captureApiError).toHaveBeenCalledTimes(1)
  })
})

type LiveInstance = Awaited<ReturnType<typeof liveAuth>>["instance"]

/** A sign-in posted to the live handler, as the login page posts it. */
const postSignIn = (instance: LiveInstance, email: string, password: string) =>
  instance.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  )

const sessionCookie = (response: Response) =>
  response.headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="))?.split(";")[0]

const DAY_MS = 24 * 60 * 60 * 1000

describe("who a request is signed in as (readSessionUserId: the proxy, the seam, /api/auth/me)", () => {
  /** A signed-in login, with lib/auth.ts's `auth` answering through the live instance. */
  async function signedIn() {
    const { instance, db } = await liveAuth()
    const id = seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const answer = await postSignIn(instance, "client@example.com", PASSWORD)
    Object.assign(auth, { api: instance.api })
    return { instance, db, id, cookie: sessionCookie(answer)!, token: answer.headers.get("set-auth-token")! }
  }

  afterEach(() => {
    delete (auth as { api?: unknown }).api
  })

  it("is the session the cookie names, or the bearer token's, and nobody without either", async () => {
    const { id, cookie, token } = await signedIn()
    expect(await readSessionUserId(new Headers({ cookie }))).toBe(id)
    expect(await readSessionUserId(new Headers({ authorization: `Bearer ${token}` }))).toBe(id)
    expect(await readSessionUserId(new Headers())).toBeNull()
    expect(await readSessionUserId(new Headers({ authorization: "Bearer forged.token" }))).toBeNull()
  })

  it("never renews the session: one due for renewal keeps its expiry, which only get-session moves", async () => {
    const { instance, db, cookie } = await signedIn()
    // Renewed two days ago: past updateAge (a day), so a renewing read would move it.
    const due = new Date(Date.now() + 5 * DAY_MS)
    db.session[0].expiresAt = due
    await readSessionUserId(new Headers({ cookie }))
    expect(db.session[0].expiresAt).toEqual(due)
    // The control: Better Auth's own read renews it, and answers with the new cookie.
    const renewing = await instance.handler(new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie } }))
    expect((db.session[0].expiresAt as Date).getTime()).toBeGreaterThan(due.getTime())
    expect(sessionCookie(renewing)).toBeDefined()
  })

  it("throws when the session cannot be read, Better Auth's 500 having reached Sentry once", async () => {
    vi.mocked(captureApiError).mockClear()
    const { db, cookie } = await signedIn()
    db.session = new Proxy([], {
      get() {
        throw new Error("database fault")
      },
    }) as unknown as Row[]
    await expect(readSessionUserId(new Headers({ cookie }))).rejects.toMatchObject({ statusCode: 500 })
    expect(captureApiError).toHaveBeenCalledTimes(1)
  })
})

describe("the reset link (rule 4)", () => {
  it("is emailed for a login and for no unknown address, and both get the same answer", async () => {
    vi.mocked(sendPasswordLinkEmail).mockClear()
    const { instance, db } = await liveAuth()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const known = await instance.api.requestPasswordReset({ body: { email: "client@example.com", redirectTo: "/reset-password" } })
    const unknown = await instance.api.requestPasswordReset({ body: { email: "nobody@example.com", redirectTo: "/reset-password" } })
    expect(unknown).toEqual(known)
    await backgroundSettled()
    expect(sendPasswordLinkEmail).toHaveBeenCalledTimes(1)
    const [{ user, url }] = vi.mocked(sendPasswordLinkEmail).mock.calls[0]
    expect(user.email).toBe("client@example.com")
    const token = /^http:\/\/localhost:3000\/api\/auth\/reset-password\/([A-Za-z0-9]+)\?callbackURL=%2Freset-password$/.exec(url)?.[1]
    expect(token).toBeDefined()
    expect(db.verification.map((row) => row.identifier)).toEqual([`reset-password:${token}`])
  })

  it("lands on /reset-password with its token, sets the password once, signs every device out, and then lands with the error", async () => {
    vi.mocked(sendPasswordLinkEmail).mockClear()
    const { instance, db } = await liveAuth()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    await postSignIn(instance, "client@example.com", PASSWORD)
    expect(db.session).toHaveLength(1)
    await instance.api.requestPasswordReset({ body: { email: "client@example.com", redirectTo: "/reset-password" } })
    await backgroundSettled()
    const [{ url }] = vi.mocked(sendPasswordLinkEmail).mock.calls[0]
    const token = new URL(url).pathname.split("/").pop()!

    const click = await instance.handler(new Request(url))
    expect(click.headers.get("location")).toBe(`http://localhost:3000/reset-password?token=${token}`)
    await instance.api.resetPassword({ body: { newPassword: "a brand new password", token } })
    expect(db.session).toEqual([])
    expect((await postSignIn(instance, "client@example.com", PASSWORD)).status).toBe(401)
    expect((await postSignIn(instance, "client@example.com", "a brand new password")).status).toBe(200)

    const again = await instance.handler(new Request(url))
    expect(again.headers.get("location")).toBe("http://localhost:3000/reset-password?error=INVALID_TOKEN")
    await expect(instance.api.resetPassword({ body: { newPassword: "another password", token } })).rejects.toMatchObject({
      body: { code: "INVALID_TOKEN" },
    })
  })
})

/** A forgot-password request through Better Auth's own HTTP handler, as anyone signed out can post one. */
const postResetRequest = (instance: LiveInstance, email: string, redirectTo: string) =>
  instance.handler(
    new Request("http://localhost:3000/api/auth/request-password-reset", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email, redirectTo }),
    })
  )

describe("the set-password link is the owner's alone (D17, rule 9)", () => {
  it("is the hook Better Auth runs before every endpoint", () => {
    expect(options.hooks?.before).toBe(refuseBeforeEndpoint)
  })

  it.each(["/set-password", "http://localhost:3000/set-password", "/set-password?from=owner"])(
    "in Better Auth's pipeline: a request over HTTP asking for %s is refused, one answer for every address, and nothing is written or sent",
    async (landing) => {
      vi.mocked(sendPasswordLinkEmail).mockClear()
      vi.mocked(after).mockClear()
      const { instance, db } = await liveAuth()
      seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
      const known = await postResetRequest(instance, "client@example.com", landing)
      const unknown = await postResetRequest(instance, "nobody@example.com", landing)
      expect([known.status, unknown.status]).toEqual([403, 403])
      expect(await known.json()).toEqual(await unknown.json())
      await backgroundSettled()
      expect(db.verification).toEqual([])
      expect(sendPasswordLinkEmail).not.toHaveBeenCalled()
    }
  )

  it("in Better Auth's pipeline: forgot password's own landing over HTTP is answered and emailed as before", async () => {
    vi.mocked(sendPasswordLinkEmail).mockClear()
    vi.mocked(after).mockClear()
    const { instance, db } = await liveAuth()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    expect((await postResetRequest(instance, "client@example.com", "/reset-password")).status).toBe(200)
    await backgroundSettled()
    expect(sendPasswordLinkEmail).toHaveBeenCalledTimes(1)
    expect(db.verification).toHaveLength(1)
  })

  it("in Better Auth's pipeline: the server's own call, createCoachLogin's, may ask for it; one carrying a request's headers may not", async () => {
    const { instance, db } = await liveAuth()
    await instance.api.createUser({ body: { email: "coach@example.com", name: "Coach", data: { emailVerified: true } } })
    await instance.api.requestPasswordReset({ body: { email: "coach@example.com", redirectTo: "/set-password" } })
    expect(db.verification).toHaveLength(1)
    await expect(
      instance.api.requestPasswordReset({ body: { email: "coach@example.com", redirectTo: "/set-password" }, headers: new Headers() })
    ).rejects.toMatchObject({ statusCode: 403, message: "The set-password link is sent by the owner's command alone." })
    expect(db.verification).toHaveLength(1)
  })
})

describe("forgot password's timing tells nothing (Better Auth's background work)", () => {
  it("answers before its email is sent: the send is handed to after(), which keeps it alive past the answer", async () => {
    vi.mocked(after).mockClear()
    vi.mocked(sendPasswordLinkEmail).mockClear()
    vi.mocked(sendPasswordLinkEmail).mockReturnValue(new Promise<void>(() => {}))
    try {
      const { instance, db } = await liveAuth()
      seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
      await expect(
        instance.api.requestPasswordReset({ body: { email: "client@example.com", redirectTo: "/reset-password" } })
      ).resolves.toEqual({ status: true, message: expect.any(String) })
      expect(after).toHaveBeenCalledTimes(1)
      expect(vi.mocked(after).mock.calls[0][0]).toBeInstanceOf(Promise)
    } finally {
      // The send never settles: forget it, so no later test waits on it.
      vi.mocked(after).mockClear()
      vi.mocked(sendPasswordLinkEmail).mockReset()
    }
  })

  it("outside a request after() refuses: the work runs on, and backgroundWorkSettled waits for it", async () => {
    vi.mocked(after).mockImplementationOnce(() => {
      throw new Error("`after` was called outside a request scope")
    })
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {})
    let finish!: () => void
    const task = new Promise<void>((resolve) => (finish = resolve))
    try {
      expect(() => runAfterAnswer(task)).not.toThrow()
      expect(debug).toHaveBeenCalledTimes(1)
      let settled = false
      const waiting = backgroundWorkSettled().then(() => (settled = true))
      // Every microtask runs before a timer: an empty wait would have settled by now.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(settled).toBe(false)
      finish()
      await waiting
      expect(settled).toBe(true)
    } finally {
      debug.mockRestore()
    }
  })

  it("a send that fails before it starts, the email module failing to load, reaches Sentry", async () => {
    vi.mocked(captureApiError).mockClear()
    const failed = new Error("Missing API key")
    vi.mocked(sendPasswordLinkEmail).mockRejectedValueOnce(failed)
    const { instance, db } = await liveAuth()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    await instance.api.requestPasswordReset({ body: { email: "client@example.com", redirectTo: "/reset-password" } })
    await backgroundSettled()
    expect(captureApiError).toHaveBeenCalledWith(failed, { source: "sendResetPassword" })
  })
})

describe("a session read that fails before Better Auth's endpoint runs", () => {
  afterEach(() => {
    delete (auth as { api?: unknown }).api
  })

  it("reaches Sentry from readSessionUserId; Better Auth's own errors are its after hook's", async () => {
    vi.mocked(captureApiError).mockClear()
    const unreachable = new Error("connect ECONNREFUSED")
    Object.assign(auth, { api: { getSession: vi.fn().mockRejectedValue(unreachable) } })
    await expect(readSessionUserId(new Headers())).rejects.toBe(unreachable)
    expect(captureApiError).toHaveBeenCalledWith(unreachable, { source: "readSessionUserId" })

    vi.mocked(captureApiError).mockClear()
    const answered = new APIError("INTERNAL_SERVER_ERROR")
    Object.assign(auth, { api: { getSession: vi.fn().mockRejectedValue(answered) } })
    await expect(readSessionUserId(new Headers())).rejects.toBe(answered)
    expect(captureApiError).not.toHaveBeenCalled()
  })
})

describe("making a login as services/login-service.ts does", () => {
  it("create-user, on the server with no session, makes a verified login with its password; the address again is refused", async () => {
    const { instance, db } = await liveAuth()
    const made = await instance.api.createUser({
      body: { email: "Client@Example.com", name: "Client", password: PASSWORD, data: { emailVerified: true } },
    })
    expect(db.user).toEqual([expect.objectContaining({ id: made.user.id, email: "client@example.com", emailVerified: true, role: "user" })])
    expect(db.account).toEqual([expect.objectContaining({ userId: made.user.id, providerId: "credential" })])
    await expect(
      instance.api.createUser({ body: { email: "client@example.com", name: "Again", password: PASSWORD, data: { emailVerified: true } } })
    ).rejects.toMatchObject({ body: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" } })
    expect(db.user).toHaveLength(1)
  })

  it("sign-in on the server hands back the session cookie for the route to forward", async () => {
    const { instance } = await liveAuth()
    const made = await instance.api.createUser({
      body: { email: "client@example.com", name: "Client", password: PASSWORD, data: { emailVerified: true } },
    })
    const { headers, response } = await instance.api.signInEmail({
      body: { email: "client@example.com", password: PASSWORD },
      returnHeaders: true,
    })
    expect(response.user.id).toBe(made.user.id)
    const cookie = headers.getSetCookie().find((c) => c.startsWith("better-auth.session_token="))
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\//)
  })

  it("a coach's login has no password until the set-password link, which makes one", async () => {
    vi.mocked(sendPasswordLinkEmail).mockClear()
    const { instance, db } = await liveAuth()
    const made = await instance.api.createUser({ body: { email: "coach@example.com", name: "Coach", data: { emailVerified: true } } })
    expect(db.account).toEqual([])
    await instance.api.requestPasswordReset({ body: { email: "coach@example.com", redirectTo: "/set-password" } })
    await backgroundSettled()
    const [{ url }] = vi.mocked(sendPasswordLinkEmail).mock.calls[0]
    expect(url).toMatch(/\?callbackURL=%2Fset-password$/)
    await instance.api.resetPassword({ body: { newPassword: PASSWORD, token: new URL(url).pathname.split("/").pop()! } })
    expect(db.account).toEqual([expect.objectContaining({ userId: made.user.id, providerId: "credential" })])
  })
})

/** A POST to the live handler as the Account card's dialogs send one: JSON, from the app's origin, with the session cookie. */
const postAsSignedIn = (instance: LiveInstance, path: string, body: unknown, cookie?: string) =>
  instance.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
  )

/** Who a cookie is signed in as, by Better Auth's own read: the user id, or null. */
async function signedInAs(instance: LiveInstance, cookie: string): Promise<string | null> {
  const answer = await instance.handler(new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie } }))
  const body = (await answer.json()) as { user?: { id: string } } | null
  return body?.user?.id ?? null
}

/** A login with a password, signed in on two devices. */
async function signedInTwice(email: string) {
  const { instance, db } = await liveAuth()
  const id = seedLogin(db, email, bcrypt.hashSync(PASSWORD, 4))
  const laptop = sessionCookie(await postSignIn(instance, email, PASSWORD))!
  const phone = sessionCookie(await postSignIn(instance, email, PASSWORD))!
  expect(db.session).toHaveLength(2)
  return { instance, db, id, laptop, phone }
}

const NEW_PASSWORD = "a brand new password"

describe("change password (rule 6, D19): the current password, and every other device signed out", () => {
  it("in Better Auth's pipeline: a wrong current password is refused as INVALID_PASSWORD, and nothing changes", async () => {
    const { instance, db, id, laptop, phone } = await signedInTwice("coach@example.com")
    const hash = db.account[0].password
    const refused = await postAsSignedIn(instance, "/change-password", { currentPassword: WRONG, newPassword: NEW_PASSWORD, revokeOtherSessions: true }, laptop)
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ code: "INVALID_PASSWORD" })
    expect(db.account[0].password).toBe(hash)
    expect(await signedInAs(instance, laptop)).toBe(id)
    expect(await signedInAs(instance, phone)).toBe(id)
  })

  it("in Better Auth's pipeline: the right one sets the new password, ends every other session, and keeps this device signed in on a new one", async () => {
    const { instance, db, id, laptop, phone } = await signedInTwice("coach@example.com")
    const changed = await postAsSignedIn(instance, "/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true }, laptop)
    expect(changed.status).toBe(200)
    const renewed = sessionCookie(changed)
    expect(renewed).toBeDefined()
    expect(db.session).toHaveLength(1)
    expect(await signedInAs(instance, phone)).toBeNull()
    expect(await signedInAs(instance, laptop)).toBeNull()
    expect(await signedInAs(instance, renewed!)).toBe(id)
    expect((await postSignIn(instance, "coach@example.com", PASSWORD)).status).toBe(401)
    expect((await postSignIn(instance, "coach@example.com", NEW_PASSWORD)).status).toBe(200)
  })

  it("in Better Auth's pipeline: a new password under the shared length is refused, whatever the dialog let through", async () => {
    const { instance, laptop } = await signedInTwice("coach@example.com")
    const short = "x".repeat(PASSWORD_MIN_LENGTH - 1)
    const refused = await postAsSignedIn(instance, "/change-password", { currentPassword: PASSWORD, newPassword: short, revokeOtherSessions: true }, laptop)
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" })
  })
})

/** Change email's link a sender was handed, and its token, as the email carries them, landing on the asker's Settings. */
const changeEmailLink = (landing: "/settings" | "/client/settings") =>
  new RegExp(`^http://localhost:3000/api/auth/verify-email\\?token=[\\w-]+\\.[\\w-]+\\.[\\w-]+&callbackURL=${encodeURIComponent(landing)}$`)

/**
 * The live instance, answering also as lib/auth.ts's `auth`: the new
 * address's check reads who is asking through readSessionUserId, which asks
 * `auth.api`, as the proxy and the seam do.
 */
async function liveAuthAsApp() {
  const live = await liveAuth()
  Object.assign(auth, { api: live.instance.api })
  return live
}

/** A change of email asked for as the client app asks: the bearer token from set-auth-token, and a cookie only when given. */
const askWithBearer = (instance: LiveInstance, token: string, cookie?: string) =>
  instance.handler(
    new Request("http://localhost:3000/api/auth/change-email", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ newEmail: "new@example.com", callbackURL: "/client/settings" }),
    })
  )

describe("change email (rules 6 and 17, D18): approved at the current address, confirmed at the new, and an address someone else holds gets the no-email answer", () => {
  beforeEach(() => {
    vi.mocked(after).mockClear()
    vi.mocked(sendApproveEmailChangeEmail).mockReset()
    vi.mocked(sendConfirmNewEmailEmail).mockReset()
    vi.mocked(isAddressHeldElsewhere).mockReset()
    vi.mocked(isAddressHeldElsewhere).mockResolvedValue(false)
  })

  afterEach(() => {
    delete (auth as { api?: unknown }).api
  })

  it("is on, its first email Approve your email change and its second Confirm your new email, each link an hour", async () => {
    expect(options.user?.changeEmail?.enabled).toBe(true)
    expect(options.emailVerification?.expiresIn).toBe(60 * 60)
    const user = { id: "u", email: "coach@example.com", name: "Sam", emailVerified: true, createdAt: new Date(), updatedAt: new Date() }
    await options.user?.changeEmail?.sendChangeEmailConfirmation?.({ user, newEmail: "new@example.com", url: "approve-link", token: "t" })
    // The new address is checked as the asker's, and no one else's: then the approval goes.
    expect(isAddressHeldElsewhere).toHaveBeenCalledWith("new@example.com", "u")
    expect(sendApproveEmailChangeEmail).toHaveBeenCalledWith({ user, newEmail: "new@example.com", url: "approve-link", token: "t" })
    await options.emailVerification?.sendVerificationEmail?.({ user, url: "confirm-link", token: "t" })
    expect(sendConfirmNewEmailEmail).toHaveBeenCalledWith({ user, url: "confirm-link", token: "t" })
  })

  it("an email module that fails to load reaches Sentry, named by Better Auth's callback, and throws nothing", async () => {
    vi.mocked(captureApiError).mockClear()
    const failed = new Error("Missing API key")
    vi.mocked(sendApproveEmailChangeEmail).mockRejectedValueOnce(failed)
    const user = { id: "u", email: "coach@example.com", name: "Sam", emailVerified: true, createdAt: new Date(), updatedAt: new Date() }
    await expect(
      options.user?.changeEmail?.sendChangeEmailConfirmation?.({ user, newEmail: "new@example.com", url: "approve-link", token: "t" })
    ).resolves.toBeUndefined()
    expect(captureApiError).toHaveBeenCalledWith(failed, { source: "sendChangeEmailConfirmation" })
  })

  it("runs no database hook of the app's after a login is updated: migration 210's trigger copies the address, in the statement that changes it", () => {
    expect(Object.keys(options.databaseHooks?.user ?? {})).toEqual(["create"])
    expect(options.databaseHooks?.user?.update).toBeUndefined()
  })

  it.each([
    ["a coach", "coach@example.com", "/settings"],
    ["a client", "client@example.com", "/client/settings"],
  ] as const)(
    "in Better Auth's pipeline: %s's change is checked for the new address, and only the second link changes it, landing on their Settings",
    async (_label, email, landing) => {
      const { instance, db } = await liveAuthAsApp()
      const id = seedLogin(db, email, bcrypt.hashSync(PASSWORD, 4))
      const cookie = sessionCookie(await postSignIn(instance, email, PASSWORD))!

      const asked = await postAsSignedIn(instance, "/change-email", { newEmail: "New@Example.com", callbackURL: landing }, cookie)
      expect(asked.status).toBe(200)
      await backgroundSettled()
      // Lower-cased, as the endpoint reads it and every copy is stored, and asked as the login that asks.
      expect(isAddressHeldElsewhere).toHaveBeenCalledWith("new@example.com", id)
      expect(sendApproveEmailChangeEmail).toHaveBeenCalledTimes(1)
      const [{ user: current, newEmail, url: approveUrl }] = vi.mocked(sendApproveEmailChangeEmail).mock.calls[0]
      expect(current.email).toBe(email)
      expect(newEmail).toBe("new@example.com")
      expect(approveUrl).toMatch(changeEmailLink(landing))
      // A token Better Auth signs: nothing is stored, and the address stands.
      expect(db.verification).toEqual([])
      expect(db.user[0].email).toBe(email)
      expect(sendConfirmNewEmailEmail).not.toHaveBeenCalled()

      const approved = await instance.handler(new Request(approveUrl, { headers: { cookie } }))
      expect(approved.headers.get("location")).toBe(landing)
      await backgroundSettled()
      expect(sendConfirmNewEmailEmail).toHaveBeenCalledTimes(1)
      const [{ user: next, url: confirmUrl }] = vi.mocked(sendConfirmNewEmailEmail).mock.calls[0]
      expect(next.email).toBe("new@example.com")
      expect(confirmUrl).toMatch(changeEmailLink(landing))
      expect(db.user[0].email).toBe(email)

      const confirmed = await instance.handler(new Request(confirmUrl, { headers: { cookie } }))
      expect(confirmed.headers.get("location")).toBe(landing)
      expect(db.user[0]).toMatchObject({ id, email: "new@example.com", emailVerified: true })
      expect((await postSignIn(instance, "new@example.com", PASSWORD)).status).toBe(200)
      expect((await postSignIn(instance, email, PASSWORD)).status).toBe(401)
      // Only the change asked the check: neither link, nor the sign-ins.
      expect(isAddressHeldElsewhere).toHaveBeenCalledTimes(1)
    }
  )

  it("in Better Auth's pipeline: an address a coach row or a client row of someone else holds is answered as a free one and one a login has are, and no approval is sent for it", async () => {
    vi.mocked(isAddressHeldElsewhere).mockImplementation((address) => Promise.resolve(address === "held@example.com"))
    const { instance, db } = await liveAuthAsApp()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    seedLogin(db, "taken@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "client@example.com", PASSWORD))!
    const ask = (newEmail: string) => postAsSignedIn(instance, "/change-email", { newEmail, callbackURL: "/client/settings" }, cookie)

    const held = await ask("held@example.com")
    // An address a login has, which Better Auth answers itself, and a free one.
    const taken = await ask("taken@example.com")
    const free = await ask("free@example.com")
    expect([held.status, taken.status, free.status]).toEqual([200, 200, 200])
    const [heldBody, takenBody, freeBody] = await Promise.all([held.json(), taken.json(), free.json()])
    expect(heldBody).toEqual(takenBody)
    expect(heldBody).toEqual(freeBody)
    await backgroundSettled()
    // The free address alone gets its approval.
    expect(vi.mocked(sendApproveEmailChangeEmail).mock.calls.map(([data]) => data.newEmail)).toEqual(["free@example.com"])
    expect(db.verification).toEqual([])
    expect(db.user[0].email).toBe("client@example.com")
  })

  it("in Better Auth's pipeline: a body Better Auth refuses is refused alike whoever holds the address, so no answer tests an address", async () => {
    vi.mocked(isAddressHeldElsewhere).mockImplementation((address) => Promise.resolve(address === "held@example.com"))
    const { instance, db } = await liveAuthAsApp()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "client@example.com", PASSWORD))!
    const held = await postAsSignedIn(instance, "/change-email", { newEmail: "held@example.com", callbackURL: 0 }, cookie)
    const free = await postAsSignedIn(instance, "/change-email", { newEmail: "free@example.com", callbackURL: 0 }, cookie)
    expect([held.status, free.status]).toEqual([400, 400])
    expect(await held.json()).toEqual(await free.json())
    await backgroundSettled()
    expect(isAddressHeldElsewhere).not.toHaveBeenCalled()
    expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: a row that can't be read sends nothing and reaches Sentry, the answer Better Auth's own", async () => {
    vi.mocked(captureApiError).mockClear()
    const unreadable = new Error("Failed to read the client rows holding the address: timeout")
    vi.mocked(isAddressHeldElsewhere).mockRejectedValue(unreadable)
    const { instance, db } = await liveAuthAsApp()
    const id = seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "client@example.com", PASSWORD))!
    const answered = await postAsSignedIn(instance, "/change-email", { newEmail: "new@example.com", callbackURL: "/client/settings" }, cookie)
    expect(answered.status).toBe(200)
    expect(await answered.json()).toEqual({ status: true })
    await backgroundSettled()
    expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
    expect(captureApiError).toHaveBeenCalledWith(unreadable, { source: "sendChangeEmailConfirmation", userId: id })
    expect(db.user[0].email).toBe("client@example.com")
  })

  it("in Better Auth's pipeline: signed out, the endpoint answers 401 itself and no row is read; no other endpoint reads one", async () => {
    const { instance, db } = await liveAuthAsApp()
    seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const signedOut = await postAsSignedIn(instance, "/change-email", { newEmail: "new@example.com", callbackURL: "/settings" })
    expect(signedOut.status).toBe(401)
    const cookie = sessionCookie(await postSignIn(instance, "coach@example.com", PASSWORD))!
    expect(await signedInAs(instance, cookie)).toBe(db.user[0].id)
    expect(isAddressHeldElsewhere).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: a string longer than any address, which Better Auth takes, is answered as any other and sent nothing, no row read", async () => {
    const { instance, db } = await liveAuthAsApp()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "client@example.com", PASSWORD))!
    const answered = await postAsSignedIn(instance, "/change-email", { newEmail: `${"a".repeat(320)}@example.com`, callbackURL: "/client/settings" }, cookie)
    expect(answered.status).toBe(200)
    expect(await answered.json()).toEqual({ status: true })
    await backgroundSettled()
    expect(isAddressHeldElsewhere).not.toHaveBeenCalled()
    expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
  })

  it.each([
    ["no address", 42],
    ["a string that is not an address", "not-an-address"],
  ])("in Better Auth's pipeline: a body with %s is the endpoint's own to refuse, and no row is read", async (_label, newEmail) => {
    const { instance, db } = await liveAuthAsApp()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "client@example.com", PASSWORD))!
    const refused = await postAsSignedIn(instance, "/change-email", { newEmail, callbackURL: "/client/settings" }, cookie)
    expect(refused.status).toBe(400)
    expect(isAddressHeldElsewhere).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: a bearer token with no cookie, as the client app sends it, is read as its login", async () => {
    const { instance, db } = await liveAuthAsApp()
    const id = seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    // Held for this login alone: an answer without an email shows the check read who the bearer token is.
    vi.mocked(isAddressHeldElsewhere).mockImplementation((_address, userId) => Promise.resolve(userId === id))
    const token = (await postSignIn(instance, "client@example.com", PASSWORD)).headers.get("set-auth-token")!
    expect(token).toBeTruthy()
    const answered = await askWithBearer(instance, token)
    expect(answered.status).toBe(200)
    expect(await answered.json()).toEqual({ status: true })
    await backgroundSettled()
    expect(isAddressHeldElsewhere).toHaveBeenCalledWith("new@example.com", id)
    expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
    expect(db.user[0].email).toBe("client@example.com")
  })

  it("in Better Auth's pipeline: a bearer token beside another login's cookie is read as the bearer's login, the one Better Auth acts as", async () => {
    const { instance, db } = await liveAuthAsApp()
    const coach = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const client = seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    vi.mocked(isAddressHeldElsewhere).mockImplementation((_address, userId) => Promise.resolve(userId === client))
    const coachCookie = sessionCookie(await postSignIn(instance, "coach@example.com", PASSWORD))!
    const clientToken = (await postSignIn(instance, "client@example.com", PASSWORD)).headers.get("set-auth-token")!
    const answered = await askWithBearer(instance, clientToken, coachCookie)
    expect(answered.status).toBe(200)
    await backgroundSettled()
    expect(isAddressHeldElsewhere).toHaveBeenCalledWith("new@example.com", client)
    expect(isAddressHeldElsewhere).not.toHaveBeenCalledWith("new@example.com", coach)
    expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: a login's own bearer token, to an address no one else holds, is let through and the approval sent (the control)", async () => {
    const { instance, db } = await liveAuthAsApp()
    const id = seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const token = (await postSignIn(instance, "client@example.com", PASSWORD)).headers.get("set-auth-token")!
    const asked = await askWithBearer(instance, token)
    expect(asked.status).toBe(200)
    await backgroundSettled()
    expect(isAddressHeldElsewhere).toHaveBeenCalledWith("new@example.com", id)
    expect(sendApproveEmailChangeEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendApproveEmailChangeEmail).mock.calls[0][0].user.email).toBe("client@example.com")
    expect(vi.mocked(sendApproveEmailChangeEmail).mock.calls[0][0].url).toMatch(changeEmailLink("/client/settings"))
  })
})

describe("sign out everywhere (rule 7, D14)", () => {
  it("in Better Auth's pipeline: revoke-sessions ends every session of the login, this device's included", async () => {
    const { instance, db, laptop, phone } = await signedInTwice("coach@example.com")
    const other = seedLogin(db, "other@example.com", bcrypt.hashSync(PASSWORD, 4))
    const theirs = sessionCookie(await postSignIn(instance, "other@example.com", PASSWORD))!
    const ended = await postAsSignedIn(instance, "/revoke-sessions", {}, laptop)
    expect(ended.status).toBe(200)
    expect(await signedInAs(instance, laptop)).toBeNull()
    expect(await signedInAs(instance, phone)).toBeNull()
    expect(db.session.map((row) => row.userId)).toEqual([other])
    expect(await signedInAs(instance, theirs)).toBe(other)
  })
})

/** Delete account's link as Better Auth builds it, landing on the login page's deleted notice; its token captured. */
const DELETE_LINK = /^http:\/\/localhost:3000\/api\/auth\/delete-user\/callback\?token=([a-z0-9]+)&callbackURL=%2Flogin%3Fdeleted%3D1$/

/** A delete-account link opened in a browser: a GET of the callback, with the browser's cookie when it has one. */
const openLink = (instance: LiveInstance, url: string, cookie?: string) =>
  instance.handler(new Request(url, { headers: cookie ? { cookie } : {} }))

describe("delete account (rules 10 and 13, D20): the password, then the emailed link, which deletes the app's records before the login", () => {
  beforeEach(() => {
    vi.mocked(after).mockClear()
    vi.mocked(captureApiError).mockClear()
    vi.mocked(sendConfirmDeleteAccountEmail).mockReset()
    vi.mocked(readLoginRole).mockReset()
    vi.mocked(readLoginRole).mockResolvedValue("trainer")
    vi.mocked(deleteAccountRecords).mockReset()
    vi.mocked(deleteAccountRecords).mockResolvedValue(undefined)
  })

  it("is on, its link lasting a day, its email worded by the asker's role and its records deleted first", () => {
    expect(options.user?.deleteUser?.enabled).toBe(true)
    expect(options.user?.deleteUser?.deleteTokenExpiresIn).toBe(DAY_MS / 1000)
    expect(options.user?.deleteUser?.sendDeleteAccountVerification).toBe(sendDeletionConfirmation)
    expect(options.user?.deleteUser?.beforeDelete).toBe(deleteRecordsBeforeLogin)
  })

  /** A coach, signed in, asking with their password for the link to the login page's deleted notice. */
  async function askToDelete(body: Record<string, unknown> = { password: PASSWORD, callbackURL: ACCOUNT_DELETED_PAGE }) {
    const { instance, db } = await liveAuth()
    const id = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "coach@example.com", PASSWORD))!
    const asked = await postAsSignedIn(instance, "/delete-user", body, cookie)
    await backgroundSettled()
    return { instance, db, id, cookie, asked }
  }

  /** The link the confirmation email was handed, and its token. */
  function emailedLink(): { url: string; token: string } {
    const url = vi.mocked(sendConfirmDeleteAccountEmail).mock.calls[0]?.[0].url ?? ""
    return { url, token: DELETE_LINK.exec(url)?.[1] ?? "" }
  }

  it("in Better Auth's pipeline: the right password emails the coach's confirmation instead of deleting, its token stored for a day", async () => {
    const { db, id, asked } = await askToDelete()
    expect(asked.status).toBe(200)
    expect(await asked.json()).toEqual({ success: true, message: "Verification email sent" })
    expect(sendConfirmDeleteAccountEmail).toHaveBeenCalledTimes(1)
    expect(sendConfirmDeleteAccountEmail).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id, email: "coach@example.com" }), account: "coach" })
    )
    const { token } = emailedLink()
    expect(token).not.toBe("")
    const row = db.verification.find((stored) => stored.identifier === `delete-account-${token}`)
    expect(row).toMatchObject({ value: id })
    expect((row!.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(DAY_MS - 60_000)
    expect(db.user.map((user) => user.id)).toEqual([id])
    expect(deleteAccountRecords).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: a client's confirmation is worded for a client", async () => {
    vi.mocked(readLoginRole).mockResolvedValue("client")
    await askToDelete()
    expect(sendConfirmDeleteAccountEmail).toHaveBeenCalledWith(expect.objectContaining({ account: "client" }))
  })

  it("in Better Auth's pipeline: a wrong password is refused as INVALID_PASSWORD, with no email and no link", async () => {
    const { db, asked } = await askToDelete({ password: WRONG, callbackURL: ACCOUNT_DELETED_PAGE })
    expect(asked.status).toBe(400)
    expect(await asked.json()).toMatchObject({ code: "INVALID_PASSWORD" })
    expect(sendConfirmDeleteAccountEmail).not.toHaveBeenCalled()
    expect(db.verification).toHaveLength(0)
  })

  it.each([
    ["no password", { callbackURL: ACCOUNT_DELETED_PAGE }],
    ["an empty password", { password: "", callbackURL: ACCOUNT_DELETED_PAGE }],
    ["a password that is no string", { password: 12345678, callbackURL: ACCOUNT_DELETED_PAGE }],
  ])("in Better Auth's pipeline: a request with %s is refused before any link is made, so a session alone never has one sent", async (_label, body) => {
    const { db, asked } = await askToDelete(body)
    expect(asked.status).toBe(400)
    expect(sendConfirmDeleteAccountEmail).not.toHaveBeenCalled()
    expect(db.verification).toHaveLength(0)
    expect(db.user).toHaveLength(1)
  })

  it("in Better Auth's pipeline: asking is limited as sign-in is, three in ten seconds, since it answers whether a password is right", async () => {
    expect(options.rateLimit?.customRules?.["/delete-user"]).toEqual({ window: 10, max: 3 })
    const { instance, db } = await liveAuth(undefined, undefined, { rateLimited: true })
    seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "coach@example.com", PASSWORD))!
    const statuses: number[] = []
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await postAsSignedIn(instance, "/delete-user", { password: WRONG, callbackURL: ACCOUNT_DELETED_PAGE }, cookie)).status)
    }
    expect(statuses).toEqual([400, 400, 400, 429])
  })

  it("in Better Auth's pipeline: the link, opened where the person is signed in, deletes the records first, then the login, and lands on the deleted notice", async () => {
    const { instance, db, id, cookie } = await askToDelete()
    let loginWhenRecordsWent: number | null = null
    vi.mocked(deleteAccountRecords).mockImplementation((user) => {
      loginWhenRecordsWent = db.user.filter((row) => row.id === user.id).length
      return Promise.resolve()
    })
    const opened = await openLink(instance, emailedLink().url, cookie)
    expect(opened.status).toBe(302)
    expect(opened.headers.get("location")).toBe(ACCOUNT_DELETED_PAGE)
    expect(deleteAccountRecords).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deleteAccountRecords).mock.calls[0][0]).toMatchObject({ id })
    expect(loginWhenRecordsWent).toBe(1)
    expect(db.user).toHaveLength(0)
    expect(db.session).toHaveLength(0)
    expect(db.account).toHaveLength(0)
    expect(opened.headers.getSetCookie().some((set) => /^better-auth\.session_token=;/.test(set))).toBe(true)
  })

  it("in Better Auth's pipeline: records that can't be deleted refuse it with the sentence, the login and its session untouched, the link spent", async () => {
    const { instance, db, id, cookie } = await askToDelete()
    vi.mocked(deleteAccountRecords).mockRejectedValue(new Error("Failed to remove 1 object(s) from progress-photos: 503"))
    const { url, token } = emailedLink()
    const opened = await openLink(instance, url, cookie)
    expect(opened.status).toBe(500)
    expect(await opened.json()).toMatchObject({ message: ACCOUNT_NOT_DELETED, code: "ACCOUNT_NOT_DELETED" })
    expect(db.user.map((user) => user.id)).toEqual([id])
    expect(await signedInAs(instance, cookie)).toBe(id)
    expect(db.verification.some((row) => row.identifier === `delete-account-${token}`)).toBe(false)
  })

  it("in Better Auth's pipeline: the link opened where no one is signed in deletes nothing", async () => {
    const { instance, db, id } = await askToDelete()
    const opened = await openLink(instance, emailedLink().url)
    expect(opened.status).toBe(404)
    expect(deleteAccountRecords).not.toHaveBeenCalled()
    expect(db.user.map((user) => user.id)).toEqual([id])
  })

  it("in Better Auth's pipeline: another login's link deletes nothing of either", async () => {
    const { instance, db, id } = await askToDelete()
    const other = seedLogin(db, "other@example.com", bcrypt.hashSync(PASSWORD, 4))
    const theirs = sessionCookie(await postSignIn(instance, "other@example.com", PASSWORD))!
    const opened = await openLink(instance, emailedLink().url, theirs)
    expect(opened.status).toBe(404)
    expect(deleteAccountRecords).not.toHaveBeenCalled()
    expect(db.user.map((user) => user.id).sort()).toEqual([id, other].sort())
  })

  it("in Better Auth's pipeline: the client app confirms by requesting the link with its bearer token alone, and the records go first, then the login", async () => {
    vi.mocked(readLoginRole).mockResolvedValue("client")
    const { instance, db } = await liveAuth()
    const id = seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const token = (await postSignIn(instance, "client@example.com", PASSWORD)).headers.get("set-auth-token")!
    const asked = await instance.handler(
      new Request("http://localhost:3000/api/auth/delete-user", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: PASSWORD, callbackURL: ACCOUNT_DELETED_PAGE }),
      })
    )
    expect(asked.status).toBe(200)
    await backgroundSettled()
    let loginWhenRecordsWent: number | null = null
    vi.mocked(deleteAccountRecords).mockImplementation((user) => {
      loginWhenRecordsWent = db.user.filter((row) => row.id === user.id).length
      return Promise.resolve()
    })
    // The app's request of the link it was handed: its bearer token, no cookie and no Origin.
    const opened = await instance.handler(new Request(emailedLink().url, { headers: { authorization: `Bearer ${token}` } }))
    expect(opened.status).toBe(302)
    expect(vi.mocked(deleteAccountRecords).mock.calls[0]?.[0]).toMatchObject({ id })
    expect(loginWhenRecordsWent).toBe(1)
    expect(db.user).toHaveLength(0)
    expect(db.session).toHaveLength(0)
    expect(db.account).toHaveLength(0)
  })
})

describe("delete account's two callbacks", () => {
  const user = { id: "u", email: "coach@example.com", name: "Sam", emailVerified: true, createdAt: new Date(), updatedAt: new Date() }
  const link = { user, url: "delete-link", token: "t" }

  beforeEach(() => {
    vi.mocked(captureApiError).mockClear()
    vi.mocked(sendConfirmDeleteAccountEmail).mockReset()
    vi.mocked(readLoginRole).mockReset()
    vi.mocked(deleteAccountRecords).mockReset()
  })

  it.each([
    ["trainer", "coach"],
    ["client", "client"],
  ] as const)("the confirmation for a %s's login is worded for a %s", async (role, account) => {
    vi.mocked(readLoginRole).mockResolvedValue(role)
    await sendDeletionConfirmation(link)
    expect(readLoginRole).toHaveBeenCalledWith("u")
    expect(sendConfirmDeleteAccountEmail).toHaveBeenCalledWith({ ...link, account })
  })

  it("a login with no role, or a role that can't be read, gets no email, and Sentry hears of it", async () => {
    vi.mocked(readLoginRole).mockResolvedValueOnce(null)
    await expect(sendDeletionConfirmation(link)).resolves.toBeUndefined()
    const failed = new Error("connection reset")
    vi.mocked(readLoginRole).mockRejectedValueOnce(failed)
    await expect(sendDeletionConfirmation(link)).resolves.toBeUndefined()
    expect(sendConfirmDeleteAccountEmail).not.toHaveBeenCalled()
    expect(captureApiError).toHaveBeenCalledTimes(2)
    expect(captureApiError).toHaveBeenLastCalledWith(failed, { source: "sendDeleteAccountVerification", userId: "u" })
  })

  it("beforeDelete hands the login to deleteAccountRecords, and turns its failure, already reported, into the refusal", async () => {
    vi.mocked(deleteAccountRecords).mockResolvedValueOnce(undefined)
    await expect(deleteRecordsBeforeLogin({ id: "u" })).resolves.toBeUndefined()
    expect(deleteAccountRecords).toHaveBeenCalledWith({ id: "u" })
    vi.mocked(deleteAccountRecords).mockRejectedValueOnce(new Error("delete_coach_records failed: timeout"))
    const refused = await deleteRecordsBeforeLogin({ id: "u" }).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(APIError)
    expect(refused).toMatchObject({ statusCode: 500, body: { message: ACCOUNT_NOT_DELETED, code: "ACCOUNT_NOT_DELETED" } })
    expect(captureApiError).not.toHaveBeenCalled()
  })
})

/** Google's sign-in page, the callback Google sends the browser back to, and Google's token endpoint, which the callback asks. */
const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_CALLBACK = "http://localhost:3000/api/auth/callback/google"
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"

/** The login page's Continue with Google, as authClient.signIn.social posts it: landing on /, or refused, on /login. */
const askGoogle = (instance: LiveInstance) =>
  instance.handler(
    new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ provider: "google", callbackURL: "/", errorCallbackURL: "/login" }),
    })
  )

/** A Google account, as its ID token describes it. */
type GoogleAccount = { sub: string; email: string; email_verified: boolean; name?: string }

/**
 * The ID token Google's token endpoint answers with. Better Auth reads it from
 * the answer to its own request to Google and checks no signature there, so
 * an unsigned one stands in for Google's.
 */
function googleIdToken(account: GoogleAccount): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  const claims = { iss: "https://accounts.google.com", aud: ENV.GOOGLE_CLIENT_ID, iat: now, exp: now + 3600, name: "Google Name", ...account }
  return [part({ alg: "RS256", kid: "test", typ: "JWT" }), part(claims), "signature"].join(".")
}

/** The button's request answered: Google's sign-in page, and the browser's state cookie, as the browser carries them to Google and back. */
async function startGoogle(instance: LiveInstance) {
  const asked = await askGoogle(instance)
  const authorize = new URL(asked.headers.get("location") ?? "")
  const cookie = asked.headers.getSetCookie().map((set) => set.split(";")[0]).join("; ")
  return { authorize, state: authorize.searchParams.get("state") ?? "", cookie }
}

/**
 * Google sending the browser back to the callback, `query` its own (a code,
 * or Google's error), with the browser's state cookie unless `cookie` is
 * empty. Better Auth trades a code at Google's token endpoint, answered here
 * as Google answers for `account`, or with `refusal` (a trade Google refuses).
 * Returns the callback's answer and each trade's form.
 */
async function returnFromGoogle(
  instance: LiveInstance,
  { state, cookie }: { state: string; cookie: string },
  account: GoogleAccount,
  { query = "code=google-code", refusal }: { query?: string; refusal?: Response } = {}
) {
  const trades: URLSearchParams[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url !== GOOGLE_TOKEN) return Promise.reject(new Error(`No other request leaves the callback: ${url}`))
      trades.push(new URLSearchParams(String(init?.body)))
      return Promise.resolve(
        refusal ??
          Response.json({ access_token: "google-access-token", expires_in: 3599, token_type: "Bearer", scope: "openid email profile", id_token: googleIdToken(account) })
      )
    })
  )
  try {
    const back = await instance.handler(new Request(`${GOOGLE_CALLBACK}?${query}&state=${state}`, { headers: cookie ? { cookie } : {} }))
    return { back, trades }
  } finally {
    vi.unstubAllGlobals()
  }
}

/** Continue with Google from the click to the landing, Google answering for `account`. */
async function signInWithGoogle(instance: LiveInstance, account: GoogleAccount) {
  return returnFromGoogle(instance, await startGoogle(instance), account)
}

describe("Continue with Google (rule 8, D3, D23): sign-in only, to the login that has the Google address", () => {
  it("is Google alone, its keys from the env, sign-up off, the account chooser every time, and the login's address never rewritten", () => {
    expect(Object.keys(options.socialProviders ?? {})).toEqual(["google"])
    expect(options.socialProviders?.google).toEqual({
      clientId: ENV.GOOGLE_CLIENT_ID,
      clientSecret: ENV.GOOGLE_CLIENT_SECRET,
      disableSignUp: true,
      prompt: "select_account",
      overrideUserInfoOnSignIn: false,
    })
  })

  it("links by address as Better Auth does by default: no trusted provider, and nothing of the Google profile copied onto the login", () => {
    expect(options.account?.accountLinking).toEqual({ enabled: true })
  })

  it("turns off linking and unlinking a Google account by hand: Google is for sign-in only", () => {
    expect(options.disabledPaths).toEqual(expect.arrayContaining(["/link-social", "/unlink-account"]))
  })

  it("in Better Auth's pipeline: a signed-in login's request to link or unlink a Google account answers 404, and its accounts stay as they were", async () => {
    const { instance, db } = await liveAuth()
    const id = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie((await signInWithGoogle(instance, { sub: "google-1", email: "coach@example.com", email_verified: true })).back)!
    const accounts = structuredClone(db.account)
    for (const [path, body] of [
      ["/link-social", { provider: "google", callbackURL: "/" }],
      ["/unlink-account", { providerId: "google" }],
    ] as const) {
      const answer = await instance.handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
          body: JSON.stringify(body),
        })
      )
      expect(answer.status, path).toBe(404)
    }
    expect(await signedInAs(instance, cookie)).toBe(id)
    expect(db.account).toEqual(accounts)
  })

  it("in Better Auth's pipeline: the button's request answers Google's sign-in page, with the app's callback, the chooser and a PKCE challenge", async () => {
    const { instance, db } = await liveAuth()
    const asked = await askGoogle(instance)
    expect(asked.status).toBe(200)
    const body = (await asked.json()) as { url: string; redirect: boolean }
    expect(body.redirect).toBe(true)
    expect(asked.headers.get("location")).toBe(body.url)
    const url = new URL(body.url)
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZE)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: ENV.GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_CALLBACK,
      response_type: "code",
      prompt: "select_account",
      code_challenge_method: "S256",
    })
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile"])
    expect(url.searchParams.get("state")).toBeTruthy()
    expect(url.searchParams.get("code_challenge")).toBeTruthy()
    expect(body.url).not.toContain(ENV.GOOGLE_CLIENT_SECRET)
    // The state the callback checks, kept for ten minutes.
    expect(db.verification).toHaveLength(1)
  })

  it("in Better Auth's pipeline: a Google address no login has lands on /login?error=signup_disabled, and nothing is made", async () => {
    const { instance, db } = await liveAuth()
    const { back, trades } = await signInWithGoogle(instance, { sub: "google-1", email: "stranger@example.com", email_verified: true })
    expect(back.status).toBe(302)
    expect(back.headers.get("location")).toBe(`/login?error=${LOGIN_ERROR_GOOGLE_NO_ACCOUNT}`)
    expect(db.user).toEqual([])
    expect(db.account).toEqual([])
    expect(db.session).toEqual([])
    // The code was traded once, with the callback the button sent Google.
    expect(trades.map((form) => form.get("redirect_uri"))).toEqual([GOOGLE_CALLBACK])
  })

  it("in Better Auth's pipeline: with Google's own refusal off, the guard on making a login still refuses it, and nothing is made", async () => {
    const { instance, db } = await liveAuth(undefined, undefined, {
      socialProviders: {
        google: { clientId: ENV.GOOGLE_CLIENT_ID, clientSecret: ENV.GOOGLE_CLIENT_SECRET, disableSignUp: false, prompt: "select_account", overrideUserInfoOnSignIn: false },
      },
    })
    const { back } = await signInWithGoogle(instance, { sub: "google-1", email: "stranger@example.com", email_verified: true })
    // Better Auth answers the guard's refusal itself, with no redirect: the second lock, behind disableSignUp.
    expect(back.status).toBe(403)
    expect(await back.json()).toMatchObject({ message: "Accounts are created by invitation." })
    expect(db.user).toEqual([])
    expect(db.account).toEqual([])
    expect(db.session).toEqual([])
  })

  it("in Better Auth's pipeline: a Google address a login has signs that login in, links the Google account to it, lands on /, and changes nothing of the login", async () => {
    const { instance, db } = await liveAuth()
    const id = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const { back } = await signInWithGoogle(instance, { sub: "google-1", email: "Coach@Example.com", email_verified: true, name: "Someone Else" })
    expect(back.status).toBe(302)
    expect(back.headers.get("location")).toBe("/")
    expect(await signedInAs(instance, sessionCookie(back)!)).toBe(id)
    expect(db.account).toEqual([
      expect.objectContaining({ providerId: "credential", userId: id }),
      expect.objectContaining({ providerId: "google", accountId: "google-1", userId: id }),
    ])
    expect(db.user).toEqual([expect.objectContaining({ id, email: "coach@example.com", name: "Proof", emailVerified: true })])
  })

  it.each([
    ["Google hasn't verified that the address is the account's", false, true],
    ["the login's address isn't verified", true, false],
  ])(
    "in Better Auth's pipeline: a Google address a login has is not linked when %s: /login?error=account_not_linked, and nothing is made",
    async (_label, googleVerified, loginVerified) => {
      const { instance, db } = await liveAuth()
      const id = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4), loginVerified)
      const { back } = await signInWithGoogle(instance, { sub: "google-1", email: "coach@example.com", email_verified: googleVerified })
      expect(back.status).toBe(302)
      expect(back.headers.get("location")).toBe(`/login?error=${LOGIN_ERROR_GOOGLE_NOT_LINKED}`)
      expect(db.account).toEqual([expect.objectContaining({ providerId: "credential", userId: id })])
      expect(db.session).toEqual([])
    }
  )

  it("in Better Auth's pipeline: a linked Google account signs its login in by the account, after the Google account's own address changed too, and never rewrites the login's", async () => {
    const { instance, db } = await liveAuth()
    const id = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    await signInWithGoogle(instance, { sub: "google-1", email: "coach@example.com", email_verified: true })
    // Google's side renamed the account (a Workspace address changed, say): it is still the account linked.
    const { back } = await signInWithGoogle(instance, { sub: "google-1", email: "renamed@example.com", email_verified: true })
    expect(back.headers.get("location")).toBe("/")
    expect(await signedInAs(instance, sessionCookie(back)!)).toBe(id)
    expect(db.user[0]).toMatchObject({ id, email: "coach@example.com" })
  })

  it("in Better Auth's pipeline: once the login's address changes and its Google link goes with it, the old address's Google account finds no login and the new address's links", async () => {
    const { instance, db } = await liveAuth()
    const id = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    await signInWithGoogle(instance, { sub: "google-1", email: "coach@example.com", email_verified: true })
    // The UPDATE that changes the address deletes the login's Google links (migration 213's trigger, which
    // scripts/email-follows-proof.ts shows on DEV); here the rows change as that one statement leaves them.
    db.user[0].email = "new@example.com"
    db.account.splice(0, db.account.length, ...db.account.filter((row) => row.userId !== id || row.providerId === "credential"))
    const old = await signInWithGoogle(instance, { sub: "google-1", email: "coach@example.com", email_verified: true })
    expect(old.back.headers.get("location")).toBe(`/login?error=${LOGIN_ERROR_GOOGLE_NO_ACCOUNT}`)
    const renewed = await signInWithGoogle(instance, { sub: "google-2", email: "new@example.com", email_verified: true })
    expect(renewed.back.headers.get("location")).toBe("/")
    expect(await signedInAs(instance, sessionCookie(renewed.back)!)).toBe(id)
    expect(db.account).toEqual([
      expect.objectContaining({ providerId: "credential", userId: id }),
      expect.objectContaining({ providerId: "google", accountId: "google-2", userId: id }),
    ])
  })

  it("in Better Auth's pipeline: a login with no password that Google signed in is answered CREDENTIAL_ACCOUNT_NOT_FOUND by change password and delete account", async () => {
    const { instance, db } = await liveAuth()
    // As coach:create makes it: verified, no password until the set-password link.
    const made = await instance.api.createUser({ body: { email: "coach@example.com", name: "Coach", data: { emailVerified: true } } })
    const { back } = await signInWithGoogle(instance, { sub: "google-1", email: "coach@example.com", email_verified: true })
    const cookie = sessionCookie(back)!
    expect(await signedInAs(instance, cookie)).toBe(made.user.id)
    const changed = await postAsSignedIn(instance, "/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true }, cookie)
    const deleting = await postAsSignedIn(instance, "/delete-user", { password: PASSWORD, callbackURL: ACCOUNT_DELETED_PAGE }, cookie)
    expect([changed.status, deleting.status]).toEqual([400, 400])
    expect(await changed.json()).toMatchObject({ code: "CREDENTIAL_ACCOUNT_NOT_FOUND" })
    expect(await deleting.json()).toMatchObject({ code: "CREDENTIAL_ACCOUNT_NOT_FOUND" })
    expect(db.account).toEqual([expect.objectContaining({ providerId: "google", userId: made.user.id })])
  })

  it("sends a Google sign-in that fails before its own landing is known to the login page, never Better Auth's own error page", () => {
    expect(options.onAPIError?.errorURL).toBe("/login")
  })

  /** Every report Sentry was handed for a failed Google sign-in. */
  const googleFailures = () =>
    vi.mocked(captureApiError).mock.calls.filter(([error]) => error instanceof Error && error.message.startsWith("Continue with Google failed"))

  it("in Better Auth's pipeline: a code Google won't trade, as with a wrong client secret, lands on /login?error=invalid_code, makes nothing, and reaches Sentry", async () => {
    vi.mocked(captureApiError).mockClear()
    const { instance, db } = await liveAuth()
    seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const refusal = Response.json({ error: "invalid_client", error_description: "The OAuth client was not found." }, { status: 401 })
    const { back } = await returnFromGoogle(instance, await startGoogle(instance), { sub: "google-1", email: "coach@example.com", email_verified: true }, { refusal })
    expect(back.status).toBe(302)
    expect(back.headers.get("location")).toBe("/login?error=invalid_code")
    expect(db.session).toEqual([])
    expect(googleFailures()).toHaveLength(1)
    expect(googleFailures()[0][1]).toMatchObject({ route: expect.stringMatching(/^\/api\/auth\/callback\//), error: "invalid_code" })
  })

  it("in Better Auth's pipeline: a state used once already, Back to Google's page after signing in, lands on /login?error=state_mismatch and reaches Sentry", async () => {
    vi.mocked(captureApiError).mockClear()
    const { instance, db } = await liveAuth()
    const id = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const started = await startGoogle(instance)
    const account = { sub: "google-1", email: "coach@example.com", email_verified: true }
    expect((await returnFromGoogle(instance, started, account)).back.headers.get("location")).toBe("/")
    const again = await returnFromGoogle(instance, started, account)
    expect(again.back.status).toBe(302)
    expect(again.back.headers.get("location")).toBe("/login?error=state_mismatch")
    expect(db.session.map((row) => row.userId)).toEqual([id])
    expect(googleFailures().map(([, context]) => (context as { error: string }).error)).toEqual(["state_mismatch"])
  })

  it.each([
    ["a Google address no login has", { sub: "google-1", email: "stranger@example.com", email_verified: true }, "code=google-code", LOGIN_ERROR_GOOGLE_NO_ACCOUNT],
    ["an address Google hasn't verified", { sub: "google-1", email: "coach@example.com", email_verified: false }, "code=google-code", LOGIN_ERROR_GOOGLE_NOT_LINKED],
    ["a person who said no on Google's page", { sub: "google-1", email: "coach@example.com", email_verified: true }, "error=access_denied", "access_denied"],
  ])("in Better Auth's pipeline: %s is an expected refusal: it lands on /login with its code and never reaches Sentry", async (_label, account, query, code) => {
    vi.mocked(captureApiError).mockClear()
    const { instance, db } = await liveAuth()
    seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const { back } = await returnFromGoogle(instance, await startGoogle(instance), account, { query })
    expect(back.headers.get("location")).toBe(`/login?error=${code}`)
    expect(captureApiError).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: a return to the callback without the browser's state cookie, another browser's, is refused and signs nobody in", async () => {
    vi.mocked(captureApiError).mockClear()
    const { instance, db } = await liveAuth()
    seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const { state } = await startGoogle(instance)
    const { back, trades } = await returnFromGoogle(instance, { state, cookie: "" }, { sub: "google-1", email: "coach@example.com", email_verified: true })
    expect(back.status).toBe(302)
    expect(back.headers.get("location")).toMatch(/^\/login\?error=state_/)
    expect(trades).toEqual([])
    expect(db.session).toEqual([])
    expect(db.account.map((row) => row.providerId)).toEqual(["credential"])
    expect(googleFailures()).toHaveLength(1)
  })

  it("in Better Auth's pipeline: the code is traded with the verifier whose S256 is the challenge Google was sent (PKCE)", async () => {
    const { instance, db } = await liveAuth()
    seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const started = await startGoogle(instance)
    const { trades } = await returnFromGoogle(instance, started, { sub: "google-1", email: "coach@example.com", email_verified: true })
    const verifier = trades[0]?.get("code_verifier") ?? ""
    expect(verifier).not.toBe("")
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(started.authorize.searchParams.get("code_challenge"))
    expect(trades[0]?.get("client_id")).toBe(ENV.GOOGLE_CLIENT_ID)
  })

  it.each([
    ["a landing", { callbackURL: "https://evil.example/" }],
    ["an error landing", { errorCallbackURL: "https://evil.example/login" }],
  ])("in Better Auth's pipeline: %s on another site is refused before Google is asked (its origin check)", async (_label, landing) => {
    const { instance, db } = await liveAuth(undefined, undefined, { originCheck: true })
    const asked = await instance.handler(
      new Request("http://localhost:3000/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ provider: "google", callbackURL: "/", errorCallbackURL: "/login", ...landing }),
      })
    )
    expect(asked.status).toBe(403)
    expect(asked.headers.get("location")).toBeNull()
    expect(db.verification).toEqual([])
  })
})

/** A sign-in posted as the client app's fetch posts one: no cookie, its origin named by `headers`. */
const signInFromApp = (instance: LiveInstance, headers: Record<string, string>) =>
  instance.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ email: "client@example.com", password: PASSWORD }),
    })
  )

/** Continue with Google asked from the client app, as the Expo plugin's client asks: its origin in expo-origin, its landings on the scheme. */
const askGoogleFromApp = (instance: LiveInstance, landings: Record<string, string>) =>
  instance.handler(
    new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", "expo-origin": CLIENT_APP_SCHEME },
      body: JSON.stringify({ provider: "google", ...landings }),
    })
  )

describe("the client app's scheme (D25, §2.8): trusted beside the app's pages, through the Expo plugin", () => {
  it("is atletafit://, trusted bare and with Better Auth's wildcard after the app's own origin, the Expo plugin beside the bearer plugin", () => {
    expect(CLIENT_APP_SCHEME).toBe("atletafit://")
    expect(options.trustedOrigins).toEqual([ENV.NEXT_PUBLIC_APP_URL, "atletafit://", "atletafit://*"])
    expect(options.plugins?.map((plugin) => plugin.id)).toEqual(["admin", "bearer", "expo"])
  })

  it("in Better Auth's pipeline: a sign-in from the app's scheme is accepted, named by Origin or by the Expo plugin's expo-origin, and answers a bearer token", async () => {
    const { instance, db } = await liveAuth(undefined, undefined, { originCheck: true })
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    for (const headers of [{ origin: "atletafit://" }, { "expo-origin": "atletafit://" }] as Record<string, string>[]) {
      const accepted = await signInFromApp(instance, headers)
      expect(accepted.status, JSON.stringify(headers)).toBe(200)
      expect(accepted.headers.get("set-auth-token"), JSON.stringify(headers)).toBeTruthy()
    }
  })

  it.each([
    ["another site", { origin: "https://evil.example" }],
    ["another site named in expo-origin", { "expo-origin": "https://evil.example" }],
    ["another app's scheme", { origin: "evilapp://" }],
    ["Expo Go, outside next dev", { origin: "exp://192.168.1.2:8081" }],
  ])("in Better Auth's pipeline: a sign-in from %s is refused and signs nobody in", async (_label, headers) => {
    const { instance, db } = await liveAuth(undefined, undefined, { originCheck: true })
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const refused = await signInFromApp(instance, headers)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ code: "INVALID_ORIGIN" })
    expect(refused.headers.get("set-auth-token")).toBeNull()
    expect(db.session).toEqual([])
  })

  it("in Better Auth's pipeline: under next dev the Expo plugin trusts Expo Go's exp:// too", async () => {
    const environment = process.env.NODE_ENV
    vi.stubEnv("NODE_ENV", "development")
    try {
      const { instance, db } = await liveAuth(undefined, undefined, { originCheck: true })
      seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
      expect((await signInFromApp(instance, { origin: "exp://192.168.1.2:8081" })).status).toBe(200)
    } finally {
      vi.stubEnv("NODE_ENV", environment)
    }
  })

  it("in Better Auth's pipeline: Continue with Google from the app may land anywhere on the scheme; another scheme or site is refused before Google is asked", async () => {
    const { instance, db } = await liveAuth(undefined, undefined, { originCheck: true })
    for (const callbackURL of ["atletafit://", "atletafit://client", "atletafit://client/settings"]) {
      expect((await askGoogleFromApp(instance, { callbackURL, errorCallbackURL: "atletafit://login" })).status, callbackURL).toBe(200)
    }
    for (const callbackURL of ["evilapp://client", "https://evil.example/"]) {
      expect((await askGoogleFromApp(instance, { callbackURL })).status, callbackURL).toBe(403)
    }
    // One state for each sign-in begun.
    expect(db.verification).toHaveLength(3)
  })

  it("in Better Auth's pipeline: a Google sign-in landing on the scheme is handed the session in its address, the Expo plugin's way; one landing on the site is not", async () => {
    const { instance, db } = await liveAuth()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const google = { sub: "google-1", email: "client@example.com", email_verified: true }
    const asked = await askGoogleFromApp(instance, { callbackURL: "atletafit://client" })
    const state = new URL(asked.headers.get("location") ?? "").searchParams.get("state") ?? ""
    const cookie = asked.headers.getSetCookie().map((set) => set.split(";")[0]).join("; ")
    const fromApp = (await returnFromGoogle(instance, { state, cookie }, google)).back.headers.get("location") ?? ""
    expect(fromApp.startsWith("atletafit://client?cookie=")).toBe(true)
    // The callback's whole Set-Cookie header, the session's among the cookies it clears.
    expect(new URL(fromApp).searchParams.get("cookie")).toMatch(/(^|, )better-auth\.session_token=[^;]+;/)
    expect((await signInWithGoogle(instance, google)).back.headers.get("location")).toBe("/")
  })
})

describe("the Expo plugin's Google proxy is off until the client app's Continue with Google is built", () => {
  it("is among the paths Better Auth answers 404", () => {
    expect(options.disabledPaths).toContain("/expo-authorization-proxy")
  })

  it("in Better Auth's pipeline: its link naming the app's own Google sign-in answers 404, stores no state and sends the browser nowhere, and no other spelling of the path reaches it", async () => {
    const { instance } = await liveAuth()
    const authorizationURL = (await askGoogleFromApp(instance, { callbackURL: "atletafit://client" })).headers.get("location") ?? ""
    expect(authorizationURL.startsWith(GOOGLE_AUTHORIZE)).toBe(true)
    // The first is the path the rule turns off; Better Auth's router finds no endpoint at the others.
    for (const path of ["/expo-authorization-proxy", "/expo-authorization-proxy/", "/Expo-Authorization-Proxy", "/expo%2Dauthorization-proxy"]) {
      const opened = await instance.handler(new Request(`http://localhost:3000/api/auth${path}?${new URLSearchParams({ authorizationURL })}`))
      expect(opened.status, path).toBe(404)
      expect(opened.headers.get("location"), path).toBeNull()
      expect(opened.headers.getSetCookie(), path).toEqual([])
    }
  })
})

describe("an emailed link that carries a credential lands on a page of the app (D25): never the client app's scheme, whoever asks", () => {
  afterEach(() => {
    delete (auth as { api?: unknown }).api
  })

  /** A change of email asked for by a signed-in client, by the cookie's or the bearer token's session, its links landing on `callbackURL`. */
  const askToChange = (instance: LiveInstance, headers: Record<string, string>, callbackURL: string) =>
    instance.handler(
      new Request("http://localhost:3000/api/auth/change-email", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ newEmail: "new@example.com", callbackURL }),
      })
    )

  /** A client signed in, as the browser holds the session and as the client app does. */
  async function signedInBothWays() {
    vi.mocked(after).mockClear()
    vi.mocked(sendApproveEmailChangeEmail).mockReset()
    vi.mocked(isAddressHeldElsewhere).mockReset()
    vi.mocked(isAddressHeldElsewhere).mockResolvedValue(false)
    const { instance, db } = await liveAuthAsApp()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const signedIn = await postSignIn(instance, "client@example.com", PASSWORD)
    const ways: Record<string, string>[] = [
      { cookie: sessionCookie(signedIn)!, origin: "http://localhost:3000" },
      { authorization: `Bearer ${signedIn.headers.get("set-auth-token")!}` },
    ]
    return { instance, db, ways }
  }

  it.each(["atletafit://client/settings", "atletafit://", "https://evil.example/settings", "//evil.example/settings"])(
    "in Better Auth's pipeline: change email asked to land on %s is refused by cookie and by bearer token, and nothing is sent or changed",
    async (callbackURL) => {
      const { instance, db, ways } = await signedInBothWays()
      for (const headers of ways) {
        const refused = await askToChange(instance, headers, callbackURL)
        expect(refused.status, JSON.stringify(Object.keys(headers))).toBe(403)
        expect(await refused.json()).toMatchObject({ message: "An emailed link lands on a page of the app." })
      }
      await backgroundSettled()
      expect(isAddressHeldElsewhere).not.toHaveBeenCalled()
      expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
      expect(db.user[0].email).toBe("client@example.com")
    }
  )

  it("in Better Auth's pipeline: change email landing on the app's own page, as Settings asks or written out in full, is let through and its approval sent", async () => {
    const { instance, ways } = await signedInBothWays()
    for (const callbackURL of ["/client/settings", "http://localhost:3000/client/settings"]) {
      for (const headers of ways) expect((await askToChange(instance, headers, callbackURL)).status, callbackURL).toBe(200)
    }
    await backgroundSettled()
    expect(sendApproveEmailChangeEmail).toHaveBeenCalledTimes(4)
  })

  it.each(["atletafit://reset-password", "atletafit://", "https://evil.example/reset-password", "//evil.example/reset-password"])(
    "in Better Auth's pipeline: a request over HTTP asking for %s is refused, one answer for every address, and nothing is written or sent",
    async (landing) => {
      vi.mocked(sendPasswordLinkEmail).mockClear()
      vi.mocked(after).mockClear()
      const { instance, db } = await liveAuth()
      seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
      const known = await postResetRequest(instance, "client@example.com", landing)
      const unknown = await postResetRequest(instance, "nobody@example.com", landing)
      expect([known.status, unknown.status]).toEqual([403, 403])
      expect(await known.json()).toEqual(await unknown.json())
      await backgroundSettled()
      expect(db.verification).toEqual([])
      expect(sendPasswordLinkEmail).not.toHaveBeenCalled()
    }
  )

  it("in Better Auth's pipeline: the app's own page written out in full is asked for as before", async () => {
    vi.mocked(sendPasswordLinkEmail).mockClear()
    vi.mocked(after).mockClear()
    const { instance, db } = await liveAuth()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    expect((await postResetRequest(instance, "client@example.com", "http://localhost:3000/reset-password")).status).toBe(200)
    await backgroundSettled()
    expect(sendPasswordLinkEmail).toHaveBeenCalledTimes(1)
    expect(db.verification).toHaveLength(1)
  })

  it("in Better Auth's pipeline: the server's own call is held to it too, where Better Auth checks no landing", async () => {
    const { instance, db } = await liveAuth()
    seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    for (const redirectTo of ["atletafit://reset-password", "https://evil.example/reset-password"]) {
      await expect(instance.api.requestPasswordReset({ body: { email: "client@example.com", redirectTo } }), redirectTo).rejects.toMatchObject({
        statusCode: 403,
        message: "An emailed link lands on a page of the app.",
      })
    }
    expect(db.verification).toEqual([])
    await instance.api.requestPasswordReset({ body: { email: "client@example.com", redirectTo: "/reset-password" } })
    expect(db.verification).toHaveLength(1)
  })
})
