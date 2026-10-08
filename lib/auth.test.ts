// @vitest-environment node
import { describe, it, expect, vi, afterAll } from "vitest"
import bcrypt from "bcryptjs"
import type { BetterAuthOptions } from "better-auth"
import { hashPassword } from "better-auth/crypto"
import { memoryAdapter } from "better-auth/adapters/memory"

/**
 * lib/auth.ts's rules and the options it hands Better Auth: the guard on
 * making a login (D9), the two-way password check (D7), its connection to the
 * database, its refusals at start-up, and what reaches Sentry.
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

import { APIError } from "better-auth/api"
import {
  auth,
  authPool,
  refuseUnlessOwnerOrInvite,
  reportEndpointFailure,
  reportUnexpectedAuthError,
  verifyBcryptOrScrypt,
} from "./auth"
import { captureApiError } from "@/lib/error-handler"
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
