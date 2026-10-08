// @vitest-environment node
import { readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info.js"
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher.js"
import type { ProxyMatcher } from "next/dist/build/analysis/get-page-static-info"
import type { MiddlewareRouteMatch } from "next/dist/shared/lib/router/utils/middleware-route-matcher"

// Better Auth's session read (who is signed in) and the service role (reads
// the role). Both build their clients at import and throw without the env,
// so they are mocked before proxy.ts loads.
vi.mock("@/lib/auth", () => ({ readSessionUserId: vi.fn() }))
vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }))
// GET /api/auth/me's own chain, for the answer it gives once the proxy
// leaves the /api/auth/ prefix to its routes.
vi.mock("@/lib/rate-limit", () => ({ apiRateLimit: vi.fn().mockResolvedValue(null) }))
vi.mock("@/services/auth-profile-service", () => ({ getProfileAndCoach: vi.fn() }))

import { config, proxy, trainerRoutes } from "./proxy"
import { GET as getMe } from "./app/api/auth/me/route"
import { readSessionUserId } from "@/lib/auth"
import { supabaseAdmin } from "@/services/supabase-admin"
import { getProfileAndCoach } from "@/services/auth-profile-service"

/**
 * Guards the proxy matcher against auth bypasses.
 *
 * Route segments are wildcards, so a path is not a static asset just because it
 * ends in an image extension: /clients/abc.png resolves to app/(coach)/clients/[id] with
 * id="abc.png". A matcher that excludes on the trailing extension alone skips
 * the proxy for that page -- no auth check, no role redirect. Before this was
 * fixed, a logged-out GET /clients/abc.png returned 200 with the rendered app
 * shell.
 *
 * This runs the REAL exported config through Next's own compiler
 * (getMiddlewareMatchers, which is what `next build` calls) and its own runtime
 * matcher, so it tracks Next's behaviour rather than a hand-rolled reading of
 * the regex.
 */

// getMiddlewareMatchers is exported at runtime but is absent from Next's .d.ts,
// so bind it through a narrow local signature.
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (
    matcher: string | string[],
    // next.config.mjs sets neither, both of which the compiler would otherwise
    // splice into the source.
    nextConfig: { basePath?: string; i18n?: { locales: string[] } | null }
  ) => ProxyMatcher[]
}

const match = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}))

/**
 * The matcher is a plain string with no has/missing clauses, and
 * getMiddlewareRouteMatcher only consults request/query to evaluate those. So
 * the PATHNAME is the only input that decides the result; the other two
 * arguments exist purely to satisfy MiddlewareRouteMatch's signature. Testing
 * this matcher by handing it a request object proves nothing.
 */
const INERT_REQUEST = {} as Parameters<MiddlewareRouteMatch>[1]
const INERT_QUERY = {} as Parameters<MiddlewareRouteMatch>[2]
const runsProxy = (pathname: string) =>
  match(pathname, INERT_REQUEST, INERT_QUERY)

// Every file in /public. It has no nested folders -- if that ever changes, the
// matcher has to change with it, and these cases are where it surfaces.
const PUBLIC_ASSETS = [
  "/apple-touch-icon-180.png",
  "/favicon-16.png",
  "/favicon-32.png",
  "/favicon-48.png",
  "/monogram-af.png",
]

const IMAGE_EXTENSIONS = ["svg", "png", "jpg", "jpeg", "gif", "webp"]

describe("proxy matcher", () => {
  describe("runs on routes wearing an asset extension", () => {
    it.each(IMAGE_EXTENSIONS)(
      "/clients/abc.%s is app/(coach)/clients/[id], not an asset",
      (ext) => {
        expect(runsProxy(`/clients/abc.${ext}`)).toBe(true)
      }
    )

    it.each([
      "/clients/a/b.png",
      "/clients/abc.png/intake-review",
      "/dashboard/x.png",
      "/client/anything.png",
      "/api/clients/abc.png",
      "/_next/data/development/clients/abc.png.json",
    ])("%s", (pathname) => {
      expect(runsProxy(pathname)).toBe(true)
    })
  })

  describe("runs on ordinary routes", () => {
    it.each([
      "/",
      "/login",
      "/dashboard",
      "/client",
      "/clients/3f0c1a22-0000-4000-8000-000000000000",
    ])("%s", (pathname) => {
      expect(runsProxy(pathname)).toBe(true)
    })
  })

  describe("skips genuine static assets", () => {
    it.each(PUBLIC_ASSETS)("%s", (pathname) => {
      expect(runsProxy(pathname)).toBe(false)
    })

    it.each(["/favicon.ico", "/_next/static/chunks/main.js", "/_next/image"])(
      "%s",
      (pathname) => {
        expect(runsProxy(pathname)).toBe(false)
      }
    )
  })

  it("does not treat the favicon exclusion as a wildcard or a prefix", () => {
    // An unescaped dot matches any character; without an anchor it matches as a
    // prefix. Both would hand a real route a free pass.
    expect(runsProxy("/faviconXico")).toBe(true)
    expect(runsProxy("/favicon.ico-anything")).toBe(true)
  })
})

/**
 * Binds the authorization list to the coach route group.
 *
 * "Is this a coach route?" has two representations that cannot share a source:
 * the folder app/(coach)/ (what Next renders) and `trainerRoutes` (what the
 * proxy protects). Next's route manifest is a build output, so the list has to
 * be a literal — this scan is what keeps the two from drifting. A top-level
 * folder without an entry is an UNPROTECTED coach route, so that direction is
 * the one that matters; the reverse catches an entry that protects nothing.
 */
describe("trainerRoutes is bound to app/(coach)/", () => {
  const COACH_GROUP = join(__dirname, "app", "(coach)")
  // Only plain route folders live at this level. A route group, parallel slot
  // or private folder added here would not be a URL segment — extend the scan
  // when that happens rather than filtering it out silently.
  const coachSegments = readdirSync(COACH_GROUP, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${entry.name}`)

  it("protects every top-level folder of the coach route group", () => {
    expect(coachSegments.length).toBeGreaterThan(0)
    for (const segment of coachSegments) {
      expect(trainerRoutes).toContain(segment)
    }
  })

  it("lists only folders that exist in the coach route group", () => {
    for (const route of trainerRoutes) {
      expect(coachSegments).toContain(route)
    }
  })
})

/**
 * Binds the public /api/auth/ prefix to the routes beneath it. The proxy
 * leaves every path under the prefix to its route, so a route added there is
 * reached signed out with nothing checking it: the folder holds Better Auth's
 * catch-all and the app's /me, which answers its own 401, and nothing else
 * until a change here says why.
 */
describe("the public /api/auth/ prefix is bound to app/api/auth/", () => {
  /** Every route file beneath a folder, at any depth, relative to it. */
  const routeFiles = (dir: string, base = dir): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return routeFiles(full, base)
      return /^route\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [relative(base, full)] : []
    })

  it("holds exactly Better Auth's catch-all and /api/auth/me, at every depth", () => {
    expect(routeFiles(join(__dirname, "app", "api", "auth")).sort()).toEqual(["[...all]/route.ts", "me/route.ts"])
  })
})

/**
 * The decisions the proxy makes on every request, with Better Auth reading
 * the session and the service role reading the role. The stubs below decide
 * who the caller is and what row they have.
 */

/** The session the request names: a user id, none, or a read that fails. */
function session(userId: string | null | Error) {
  if (userId instanceof Error) vi.mocked(readSessionUserId).mockRejectedValue(userId)
  else vi.mocked(readSessionUserId).mockResolvedValue(userId)
}

/** The service role's profiles read resolving to `result`. */
function profile(result: { data: { role: string } | null; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ single })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabaseAdmin.from).mockReturnValue({ select } as never)
  return { from: vi.mocked(supabaseAdmin.from), select, eq, single }
}

const request = (pathname: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${pathname}`, { headers: { cookie: "better-auth.session_token=x", ...headers } })

const passesThrough = (response: Response) => response.status === 200 && response.headers.get("x-middleware-next") === "1"
const redirectsTo = (response: Response) => (response.status === 307 ? new URL(response.headers.get("location")!) : null)
const UNAUTHORIZED = { success: false, error: "Unauthorized" }

async function answersUnauthorizedJson(response: Response): Promise<boolean> {
  return (
    response.status === 401 &&
    (response.headers.get("content-type") ?? "").includes("application/json") &&
    JSON.stringify(await response.json()) === JSON.stringify(UNAUTHORIZED)
  )
}

describe("proxy decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it.each([
    "/forgot-password",
    "/reset-password",
    "/invite/abc",
    "/api/invitations/abc",
    "/api/auth/sign-in/email",
    "/api/auth/sign-up/email",
    "/api/auth/get-session",
    "/api/auth/admin/create-user",
    "/api/auth/me",
  ])(
    "%s skips auth entirely: no session is read, nothing is read",
    async (pathname) => {
      session(null)
      const read = profile({ data: null, error: null })
      expect(passesThrough(await proxy(request(pathname)))).toBe(true)
      expect(readSessionUserId).not.toHaveBeenCalled()
      expect(read.from).not.toHaveBeenCalled()
    }
  )

  it.each(["/forgot-password/x", "/reset-passwords", "/auth/callback", "/signup"])(
    "%s is no public page: signed out, it is sent to /login",
    async (pathname) => {
      session(null)
      profile({ data: null, error: null })
      expect(redirectsTo(await proxy(request(pathname)))?.pathname).toBe("/login")
    }
  )

  it.each(["/api/authentication/x", "/api/authz", "/api/auth"])(
    "the /api/auth/ prefix is a whole segment: %s is guarded like any API",
    async (pathname) => {
      session(null)
      profile({ data: null, error: null })
      expect(await answersUnauthorizedJson(await proxy(request(pathname)))).toBe(true)
      expect(readSessionUserId).toHaveBeenCalledTimes(1)
    }
  )

  it("/api/auth/me, left to the route, answers a signed-out request with its own 401 and reads nothing more", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    session(null)
    const signedOut = new NextRequest("http://localhost:3000/api/auth/me")
    expect(passesThrough(await proxy(signedOut))).toBe(true)
    expect(readSessionUserId).not.toHaveBeenCalled()
    const answer = await getMe(signedOut)
    expect(answer.status).toBe(401)
    expect(await answer.json()).toEqual(UNAUTHORIZED)
    expect(readSessionUserId).toHaveBeenCalledTimes(1)
    expect(getProfileAndCoach).not.toHaveBeenCalled()
  })

  it.each(["/dashboard", "/clients/abc", "/client", "/client/training", "/settings"])(
    "%s with no session redirects to /login, bare, and the role is never read",
    async (pathname) => {
      session(null)
      const read = profile({ data: null, error: null })
      const response = await proxy(request(pathname))
      expect(redirectsTo(response)?.pathname).toBe("/login")
      expect(redirectsTo(response)?.search).toBe("")
      expect(read.from).not.toHaveBeenCalled()
    }
  )

  it.each(["/api/clients", "/api/client/me", "/api/dashboard/attention-feed", "/api/me/unit-preference"])(
    "%s with no session answers 401 JSON, never the login page, and the role is never read (rule 16)",
    async (pathname) => {
      session(null)
      const read = profile({ data: null, error: null })
      const response = await proxy(request(pathname))
      expect(await answersUnauthorizedJson(response)).toBe(true)
      expect(response.headers.get("location")).toBeNull()
      expect(read.from).not.toHaveBeenCalled()
    }
  )

  it("reads the session from the request's own headers, whichever carries it", async () => {
    session("user-7")
    profile({ data: { role: "trainer" }, error: null })
    const withCookie = request("/dashboard")
    await proxy(withCookie)
    expect(readSessionUserId).toHaveBeenLastCalledWith(withCookie.headers)
    const withBearer = new NextRequest("http://localhost:3000/api/client/me", { headers: { authorization: "Bearer t" } })
    await proxy(withBearer)
    expect(readSessionUserId).toHaveBeenLastCalledWith(withBearer.headers)
  })

  it("reads the role through the server, keyed on the session's user id", async () => {
    session("user-7")
    const read = profile({ data: { role: "trainer" }, error: null })
    expect(passesThrough(await proxy(request("/dashboard")))).toBe(true)
    expect(read.from).toHaveBeenCalledWith("profiles")
    expect(read.select).toHaveBeenCalledWith("role")
    expect(read.eq).toHaveBeenCalledWith("user_id", "user-7")
    expect(read.eq).toHaveBeenCalledTimes(1)
    expect(read.single).toHaveBeenCalledTimes(1)
  })

  it.each(["/dashboard", "/clients/abc", "/crm", "/automation", "/settings/profile", "/api/clients", "/api/client/me", "/dashboard/programs"])(
    "a trainer on %s passes through",
    async (pathname) => {
      session("user-7")
      profile({ data: { role: "trainer" }, error: null })
      expect(passesThrough(await proxy(request(pathname)))).toBe(true)
    }
  )

  it.each(["/client", "/client/training", "/client/check-in", "/api/client/me", "/api/clients"])(
    "a client on %s passes through",
    async (pathname) => {
      session("user-8")
      profile({ data: { role: "client" }, error: null })
      expect(passesThrough(await proxy(request(pathname)))).toBe(true)
    }
  )

  it.each(trainerRoutes)("a client on the coach route %s is sent to their own home", async (route) => {
    session("user-8")
    profile({ data: { role: "client" }, error: null })
    expect(redirectsTo(await proxy(request(route)))?.pathname).toBe("/client")
    expect(redirectsTo(await proxy(request(`${route}/anything`)))?.pathname).toBe("/client")
  })

  it.each(["/client", "/client/training"])("a trainer on the client route %s is sent to the dashboard", async (pathname) => {
    session("user-7")
    profile({ data: { role: "trainer" }, error: null })
    expect(redirectsTo(await proxy(request(pathname)))?.pathname).toBe("/dashboard")
  })

  it("a coach route's prefix is a whole segment: /clientside is neither route", async () => {
    session("user-8")
    profile({ data: { role: "client" }, error: null })
    expect(passesThrough(await proxy(request("/clientside")))).toBe(true)
    expect(passesThrough(await proxy(request("/dashboards")))).toBe(true)
  })

  it.each([
    ["no profile row", { data: null, error: null }],
    ["a failed read", { data: null, error: { message: "connection refused" } }],
    ["a row with no role", { data: { role: "" }, error: null }],
  ] as const)("a session with %s fails closed: /login?error=profile_unavailable, never a role", async (_label, result) => {
    session("user-7")
    profile(result as { data: { role: string } | null; error: unknown })
    const target = redirectsTo(await proxy(request("/dashboard")))
    expect(target?.pathname).toBe("/login")
    expect(target?.searchParams.get("error")).toBe("profile_unavailable")
    expect(redirectsTo(await proxy(request("/client")))?.searchParams.get("error")).toBe("profile_unavailable")
    expect(console.error).toHaveBeenCalledWith("Profile lookup failed for authenticated user:", "user-7")
  })

  it.each(["/", "/login"])("a signed-in trainer on %s is sent to the dashboard, by a role read through the server", async (pathname) => {
    session("user-7")
    const read = profile({ data: { role: "trainer" }, error: null })
    expect(redirectsTo(await proxy(request(pathname)))?.pathname).toBe("/dashboard")
    expect(read.from).toHaveBeenCalledWith("profiles")
    expect(read.eq).toHaveBeenCalledWith("user_id", "user-7")
  })

  it.each(["/", "/login"])("a signed-in client on %s is sent to their home", async (pathname) => {
    session("user-8")
    profile({ data: { role: "client" }, error: null })
    expect(redirectsTo(await proxy(request(pathname)))?.pathname).toBe("/client")
  })

  it.each([
    ["no profile row", { data: null, error: null }],
    ["a failed read", { data: null, error: { message: "connection refused" } }],
    ["a row with no role", { data: { role: "" }, error: null }],
  ] as const)("a signed-in visitor with %s on an entry page sees the page: no guessed home", async (_label, result) => {
    for (const pathname of ["/", "/login", "/login?error=profile_unavailable"]) {
      session("user-7")
      const read = profile(result as { data: { role: string } | null; error: unknown })
      expect(passesThrough(await proxy(request(pathname)))).toBe(true)
      expect(read.eq).toHaveBeenCalledWith("user_id", "user-7")
    }
    expect(console.error).toHaveBeenCalledWith("Profile lookup failed for authenticated user:", "user-7")
  })

  it("the guarded branch's fail-closed answer is a page the entry branch shows, so nothing loops", async () => {
    session("user-7")
    profile({ data: null, error: { message: "connection refused" } })
    const sentTo = redirectsTo(await proxy(request("/dashboard")))
    expect(sentTo?.pathname).toBe("/login")
    expect(passesThrough(await proxy(request(`${sentTo!.pathname}${sentTo!.search}`)))).toBe(true)
  })

  it.each(["/", "/login"])("%s with no session passes through, and the role is never read", async (pathname) => {
    session(null)
    const read = profile({ data: null, error: null })
    expect(passesThrough(await proxy(request(pathname)))).toBe(true)
    expect(read.from).not.toHaveBeenCalled()
  })

  it("a session that cannot be read fails closed: a page goes to /login, an API answers 401, an entry page shows", async () => {
    const fault = new Error("database unreachable")
    session(fault)
    const read = profile({ data: { role: "trainer" }, error: null })
    expect(redirectsTo(await proxy(request("/dashboard")))?.pathname).toBe("/login")
    expect(await answersUnauthorizedJson(await proxy(request("/api/clients")))).toBe(true)
    expect(passesThrough(await proxy(request("/login")))).toBe(true)
    expect(read.from).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith("Session read failed:", fault)
  })

  it("never sets a cookie: the session's renewal is Better Auth's own /api/auth/get-session's", async () => {
    session("user-8")
    profile({ data: { role: "client" }, error: null })
    const responses = [await proxy(request("/dashboard")), await proxy(request("/client")), await proxy(request("/login"))]
    session(null)
    responses.push(await proxy(request("/dashboard")), await proxy(request("/api/clients")))
    for (const response of responses) expect(response.headers.getSetCookie()).toEqual([])
  })
})
