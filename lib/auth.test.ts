// @vitest-environment node
import { describe, it, expect, vi, afterAll, afterEach, beforeEach } from "vitest"
import bcrypt from "bcryptjs"
import type { BetterAuthOptions } from "better-auth"
import { hashPassword } from "better-auth/crypto"
import { memoryAdapter } from "better-auth/adapters/memory"

/**
 * lib/auth.ts's rules and the options it hands Better Auth: the guard on
 * making a login (D9), the two-way password check (D7), its connection to the
 * database, its refusals at start-up, what reaches Sentry, and the Account
 * card's three changes (change password, change email, sign out everywhere).
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
}))
// The app's rows behind Better Auth's hooks: services/account-service.test.ts proves the statements.
vi.mock("@/services/account-service", () => ({ isCoachLogin: vi.fn(), mirrorEmailToCoachRow: vi.fn() }))
// Better Auth's background work goes to Next's after(), which keeps it alive
// past the answer; here it only records the work, which runs on regardless.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }))

import { APIError } from "better-auth/api"
import {
  auth,
  authPool,
  backgroundWorkSettled,
  mirrorLoginEmail,
  readSessionUserId,
  runAfterAnswer,
  refuseBeforeEndpoint,
  refuseUnlessOwnerOrInvite,
  reportEndpointFailure,
  reportUnexpectedAuthError,
  verifyBcryptOrScrypt,
} from "./auth"
import { captureApiError } from "@/lib/error-handler"
import { sendApproveEmailChangeEmail, sendConfirmNewEmailEmail, sendPasswordLinkEmail } from "@/services/auth-email-service"
import { isCoachLogin, mirrorEmailToCoachRow } from "@/services/account-service"
import { after } from "next/server"

/** Every piece of background work handed to after() so far, settled. */
const backgroundSettled = () => Promise.all(vi.mocked(after).mock.calls.map(([task]) => task as Promise<unknown>))
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants"
import { SUPABASE_ROOT_CA } from "@/lib/supabase-connection"

/** What lib/auth.ts handed Better Auth, read as Better Auth's own option type. */
const options: BetterAuthOptions = auth.options

type Row = Record<string, unknown>

/**
 * The real Better Auth with lib/auth.ts's options, its rows in memory; email
 * and password may be swapped. Under NODE_ENV=test Better Auth skips its origin
 * check unless told not to; `originCheck` runs it, as the server always does.
 */
async function liveAuth(
  emailAndPassword?: BetterAuthOptions["emailAndPassword"],
  db: Record<string, Row[]> = { user: [], session: [], account: [], verification: [], rateLimit: [] },
  { originCheck = false }: { originCheck?: boolean } = {}
) {
  const { betterAuth } = await vi.importActual<typeof import("better-auth")>("better-auth")
  const instance = betterAuth({
    ...auth.options,
    database: memoryAdapter(db),
    emailAndPassword: emailAndPassword ?? auth.options.emailAndPassword,
    advanced: { ...auth.options.advanced, ...(originCheck ? { disableOriginCheck: false } : {}) },
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
  // Supabase stores $2a$ hashes; bcryptjs writes $2b$, the same algorithm
  // under the newer prefix.
  const supabaseHash = bcrypt.hashSync(PASSWORD, 10).replace(/^\$2b\$/, "$2a$")

  it("checks a copied Supabase hash with bcrypt", async () => {
    expect(supabaseHash.startsWith("$2a$10$")).toBe(true)
    await expect(verifyBcryptOrScrypt({ hash: supabaseHash, password: PASSWORD })).resolves.toBe(true)
    await expect(verifyBcryptOrScrypt({ hash: supabaseHash, password: WRONG })).resolves.toBe(false)
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
    ["a copied Supabase hash", () => Promise.resolve(supabaseHash)],
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
    seedLogin(db, "unverified@example.com", supabaseHash, false)
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

/** Change email's link a sender was handed, and its token, as the email carries them. */
const CHANGE_EMAIL_LINK = /^http:\/\/localhost:3000\/api\/auth\/verify-email\?token=[\w-]+\.[\w-]+\.[\w-]+&callbackURL=%2Fsettings$/

/**
 * The live instance, answering also as lib/auth.ts's `auth`: the coach-only
 * guard reads who is asking through readSessionUserId, which asks
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
      body: JSON.stringify({ newEmail: "new@example.com", callbackURL: "/settings" }),
    })
  )

describe("change email (rule 6, D18): approved at the current address, confirmed at the new, and the coach row follows", () => {
  beforeEach(() => {
    vi.mocked(after).mockClear()
    vi.mocked(sendApproveEmailChangeEmail).mockReset()
    vi.mocked(sendConfirmNewEmailEmail).mockReset()
    vi.mocked(mirrorEmailToCoachRow).mockReset()
    vi.mocked(isCoachLogin).mockReset()
    vi.mocked(isCoachLogin).mockResolvedValue(true)
  })

  afterEach(() => {
    delete (auth as { api?: unknown }).api
  })

  it("is on, its first email Approve your email change and its second Confirm your new email, each link an hour", async () => {
    expect(options.user?.changeEmail?.enabled).toBe(true)
    expect(options.emailVerification?.expiresIn).toBe(60 * 60)
    const user = { id: "u", email: "coach@example.com", name: "Sam", emailVerified: true, createdAt: new Date(), updatedAt: new Date() }
    await options.user?.changeEmail?.sendChangeEmailConfirmation?.({ user, newEmail: "new@example.com", url: "approve-link", token: "t" })
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

  it("in Better Auth's pipeline: only the second link changes the address, and the coach row follows it", async () => {
    const { instance, db } = await liveAuthAsApp()
    const id = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "coach@example.com", PASSWORD))!

    const asked = await postAsSignedIn(instance, "/change-email", { newEmail: "New@Example.com", callbackURL: "/settings" }, cookie)
    expect(asked.status).toBe(200)
    await backgroundSettled()
    expect(isCoachLogin).toHaveBeenCalledWith(id)
    expect(sendApproveEmailChangeEmail).toHaveBeenCalledTimes(1)
    const [{ user: current, newEmail, url: approveUrl }] = vi.mocked(sendApproveEmailChangeEmail).mock.calls[0]
    expect(current.email).toBe("coach@example.com")
    expect(newEmail).toBe("new@example.com")
    expect(approveUrl).toMatch(CHANGE_EMAIL_LINK)
    // A token Better Auth signs: nothing is stored, and the address stands.
    expect(db.verification).toEqual([])
    expect(db.user[0].email).toBe("coach@example.com")
    expect(sendConfirmNewEmailEmail).not.toHaveBeenCalled()

    const approved = await instance.handler(new Request(approveUrl, { headers: { cookie } }))
    expect(approved.headers.get("location")).toBe("/settings")
    await backgroundSettled()
    expect(sendConfirmNewEmailEmail).toHaveBeenCalledTimes(1)
    const [{ user: next, url: confirmUrl }] = vi.mocked(sendConfirmNewEmailEmail).mock.calls[0]
    expect(next.email).toBe("new@example.com")
    expect(confirmUrl).toMatch(CHANGE_EMAIL_LINK)
    expect(db.user[0].email).toBe("coach@example.com")
    expect(mirrorEmailToCoachRow).not.toHaveBeenCalled()

    const confirmed = await instance.handler(new Request(confirmUrl, { headers: { cookie } }))
    expect(confirmed.headers.get("location")).toBe("/settings")
    expect(db.user[0]).toMatchObject({ id, email: "new@example.com", emailVerified: true })
    expect(mirrorEmailToCoachRow).toHaveBeenCalledTimes(1)
    expect(mirrorEmailToCoachRow).toHaveBeenCalledWith(expect.objectContaining({ id, email: "new@example.com" }))
    expect((await postSignIn(instance, "new@example.com", PASSWORD)).status).toBe(200)
    expect((await postSignIn(instance, "coach@example.com", PASSWORD)).status).toBe(401)
  })

  it("in Better Auth's pipeline: a client's change is refused before anything is looked up or sent", async () => {
    vi.mocked(isCoachLogin).mockResolvedValue(false)
    const { instance, db } = await liveAuthAsApp()
    const id = seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "client@example.com", PASSWORD))!
    const refused = await postAsSignedIn(instance, "/change-email", { newEmail: "new@example.com", callbackURL: "/settings" }, cookie)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ message: "Only a coach changes the email they sign in with." })
    await backgroundSettled()
    expect(isCoachLogin).toHaveBeenCalledWith(id)
    expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
    expect(db.user[0].email).toBe("client@example.com")
  })

  it("in Better Auth's pipeline: a role that can't be read refuses the change, and nothing is sent", async () => {
    vi.mocked(isCoachLogin).mockRejectedValue(new Error("Failed to read the login's role: timeout"))
    const { instance, db } = await liveAuthAsApp()
    seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const cookie = sessionCookie(await postSignIn(instance, "coach@example.com", PASSWORD))!
    const refused = await postAsSignedIn(instance, "/change-email", { newEmail: "new@example.com", callbackURL: "/settings" }, cookie)
    expect(refused.status).toBe(500)
    await backgroundSettled()
    expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: signed out, the endpoint answers 401 itself and no role is read; no other endpoint reads one", async () => {
    const { instance, db } = await liveAuthAsApp()
    seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const signedOut = await postAsSignedIn(instance, "/change-email", { newEmail: "new@example.com", callbackURL: "/settings" })
    expect(signedOut.status).toBe(401)
    const cookie = sessionCookie(await postSignIn(instance, "coach@example.com", PASSWORD))!
    expect(await signedInAs(instance, cookie)).toBe(db.user[0].id)
    expect(isCoachLogin).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: a client's bearer token with no cookie, as the client app sends it, is refused as the cookie is", async () => {
    vi.mocked(isCoachLogin).mockResolvedValue(false)
    const { instance, db } = await liveAuthAsApp()
    const id = seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    const token = (await postSignIn(instance, "client@example.com", PASSWORD)).headers.get("set-auth-token")!
    expect(token).toBeTruthy()
    const refused = await askWithBearer(instance, token)
    expect(refused.status).toBe(403)
    await backgroundSettled()
    expect(isCoachLogin).toHaveBeenCalledWith(id)
    expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
    expect(db.user[0].email).toBe("client@example.com")
  })

  it("in Better Auth's pipeline: a client's bearer token beside a coach's cookie is refused, the bearer's login being the one Better Auth acts as", async () => {
    const { instance, db } = await liveAuthAsApp()
    const coach = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const client = seedLogin(db, "client@example.com", bcrypt.hashSync(PASSWORD, 4))
    vi.mocked(isCoachLogin).mockImplementation((userId) => Promise.resolve(userId === coach))
    const coachCookie = sessionCookie(await postSignIn(instance, "coach@example.com", PASSWORD))!
    const clientToken = (await postSignIn(instance, "client@example.com", PASSWORD)).headers.get("set-auth-token")!
    const refused = await askWithBearer(instance, clientToken, coachCookie)
    expect(refused.status).toBe(403)
    await backgroundSettled()
    expect(isCoachLogin).toHaveBeenCalledWith(client)
    expect(isCoachLogin).not.toHaveBeenCalledWith(coach)
    expect(sendApproveEmailChangeEmail).not.toHaveBeenCalled()
  })

  it("in Better Auth's pipeline: a coach's own bearer token is read as the coach and let through (the control)", async () => {
    const { instance, db } = await liveAuthAsApp()
    const id = seedLogin(db, "coach@example.com", bcrypt.hashSync(PASSWORD, 4))
    const token = (await postSignIn(instance, "coach@example.com", PASSWORD)).headers.get("set-auth-token")!
    const asked = await askWithBearer(instance, token)
    expect(asked.status).toBe(200)
    await backgroundSettled()
    expect(isCoachLogin).toHaveBeenCalledWith(id)
    expect(sendApproveEmailChangeEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendApproveEmailChangeEmail).mock.calls[0][0].user.email).toBe("coach@example.com")
  })
})

describe("the coach row's email follows the login (mirrorLoginEmail, D18)", () => {
  beforeEach(() => {
    vi.mocked(mirrorEmailToCoachRow).mockReset()
    vi.mocked(captureApiError).mockClear()
  })

  it("is the hook Better Auth runs after every update of a login", () => {
    expect(options.databaseHooks?.user?.update?.after).toBe(mirrorLoginEmail)
  })

  it("copies the login's address through services/account-service.ts", async () => {
    await mirrorLoginEmail({ id: "user-1", email: "new@example.com" })
    expect(mirrorEmailToCoachRow).toHaveBeenCalledWith({ id: "user-1", email: "new@example.com" })
  })

  it("a copy that fails reaches Sentry with the login's id and throws nothing: Better Auth has written the login by then", async () => {
    const failed = new Error("Failed to copy the login's email to the coach row: timeout")
    vi.mocked(mirrorEmailToCoachRow).mockRejectedValueOnce(failed)
    await expect(mirrorLoginEmail({ id: "user-1", email: "new@example.com" })).resolves.toBeUndefined()
    expect(captureApiError).toHaveBeenCalledWith(failed, { source: "mirrorLoginEmail", userId: "user-1" })
  })

  it("an update that found no login copies nothing", async () => {
    await mirrorLoginEmail(null)
    expect(mirrorEmailToCoachRow).not.toHaveBeenCalled()
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
