// @vitest-environment node
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info.js"
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher.js"
import type { ProxyMatcher } from "next/dist/build/analysis/get-page-static-info"
import type { MiddlewareRouteMatch } from "next/dist/shared/lib/router/utils/middleware-route-matcher"

// The session client (validates the session) and the service role (reads the
// role). services/supabase-admin.ts builds its client at import and throws
// without the env, so it is mocked before middleware.ts loads.
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }))
vi.mock("@/services/supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }))

import { config, middleware, trainerRoutes } from "./middleware"
import { createServerClient } from "@supabase/ssr"
import { supabaseAdmin } from "@/services/supabase-admin"

/**
 * Guards the middleware matcher against auth bypasses.
 *
 * Route segments are wildcards, so a path is not a static asset just because it
 * ends in an image extension: /clients/abc.png resolves to app/(coach)/clients/[id] with
 * id="abc.png". A matcher that excludes on the trailing extension alone skips
 * middleware for that page -- no auth check, no role redirect. Before this was
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
const runsMiddleware = (pathname: string) =>
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

describe("middleware matcher", () => {
  describe("runs on routes wearing an asset extension", () => {
    it.each(IMAGE_EXTENSIONS)(
      "/clients/abc.%s is app/(coach)/clients/[id], not an asset",
      (ext) => {
        expect(runsMiddleware(`/clients/abc.${ext}`)).toBe(true)
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
      expect(runsMiddleware(pathname)).toBe(true)
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
      expect(runsMiddleware(pathname)).toBe(true)
    })
  })

  describe("skips genuine static assets", () => {
    it.each(PUBLIC_ASSETS)("%s", (pathname) => {
      expect(runsMiddleware(pathname)).toBe(false)
    })

    it.each(["/favicon.ico", "/_next/static/chunks/main.js", "/_next/image"])(
      "%s",
      (pathname) => {
        expect(runsMiddleware(pathname)).toBe(false)
      }
    )
  })

  it("does not treat the favicon exclusion as a wildcard or a prefix", () => {
    // An unescaped dot matches any character; without an anchor it matches as a
    // prefix. Both would hand a real route a free pass.
    expect(runsMiddleware("/faviconXico")).toBe(true)
    expect(runsMiddleware("/favicon.ico-anything")).toBe(true)
  })
})

/**
 * Binds the authorization list to the coach route group.
 *
 * "Is this a coach route?" has two representations that cannot share a source:
 * the folder app/(coach)/ (what Next renders) and `trainerRoutes` (what the
 * Edge middleware protects). Middleware cannot read the filesystem and Next's
 * route manifest is a build output, so the list has to be a literal — this scan
 * is what keeps the two from drifting. A top-level folder without an entry is
 * an UNPROTECTED coach route, so that direction is the one that matters; the
 * reverse catches an entry that protects nothing.
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
 * The decisions the middleware makes on every request, with the session
 * client validating the session and the service role reading the role. A
 * request carries a cookie so the session client is built; the stubs below
 * decide who the caller is and what row they have.
 */
type SessionCookies = {
  setAll: (cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) => void
}

/** A session whose getUser() answers `user`; `refreshed` cookies are written during it, as a rotation would. */
function session(
  user: { id: string } | null,
  refreshed: Array<{ name: string; value: string }> = []
) {
  const sessionFrom = vi.fn()
  vi.mocked(createServerClient).mockImplementation(((_url: string, _key: string, options: { cookies: SessionCookies }) => ({
    auth: {
      getUser: vi.fn(() => {
        if (refreshed.length > 0) options.cookies.setAll(refreshed.map((c) => ({ ...c, options: { path: "/" } })))
        return Promise.resolve({ data: { user }, error: null })
      }),
    },
    from: sessionFrom,
  })) as never)
  return { sessionFrom }
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
  new NextRequest(`http://localhost:3000${pathname}`, { headers: { cookie: "sb-test-auth-token=x", ...headers } })

const passesThrough = (response: Response) => response.status === 200 && response.headers.get("x-middleware-next") === "1"
const redirectsTo = (response: Response) => (response.status === 307 ? new URL(response.headers.get("location")!) : null)

describe("middleware decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it.each(["/auth/callback", "/forgot-password", "/reset-password", "/invite/abc", "/api/invitations/abc"])(
    "%s skips auth entirely: no session is built, nothing is read",
    async (pathname) => {
      session(null)
      const read = profile({ data: null, error: null })
      expect(passesThrough(await middleware(request(pathname)))).toBe(true)
      expect(createServerClient).not.toHaveBeenCalled()
      expect(read.from).not.toHaveBeenCalled()
    }
  )

  it.each(["/dashboard", "/clients/abc", "/client", "/client/training", "/api/clients", "/api/client/me"])(
    "%s with no session redirects to /login, and the role is never read",
    async (pathname) => {
      session(null)
      const read = profile({ data: null, error: null })
      const response = await middleware(request(pathname))
      expect(redirectsTo(response)?.pathname).toBe("/login")
      expect(redirectsTo(response)?.search).toBe("")
      expect(read.from).not.toHaveBeenCalled()
    }
  )

  it("reads the role through the server, keyed on the id the session validated, and never through the session client", async () => {
    const { sessionFrom } = session({ id: "user-7" })
    const read = profile({ data: { role: "trainer" }, error: null })
    expect(passesThrough(await middleware(request("/dashboard")))).toBe(true)
    expect(read.from).toHaveBeenCalledWith("profiles")
    expect(read.select).toHaveBeenCalledWith("role")
    expect(read.eq).toHaveBeenCalledWith("user_id", "user-7")
    expect(read.eq).toHaveBeenCalledTimes(1)
    expect(read.single).toHaveBeenCalledTimes(1)
    expect(sessionFrom).not.toHaveBeenCalled()
  })

  it.each(["/dashboard", "/clients/abc", "/crm", "/automation", "/settings/profile", "/api/clients", "/api/client/me", "/dashboard/programs"])(
    "a trainer on %s passes through",
    async (pathname) => {
      session({ id: "user-7" })
      profile({ data: { role: "trainer" }, error: null })
      expect(passesThrough(await middleware(request(pathname)))).toBe(true)
    }
  )

  it.each(["/client", "/client/training", "/client/check-in", "/api/client/me", "/api/clients"])(
    "a client on %s passes through",
    async (pathname) => {
      session({ id: "user-8" })
      profile({ data: { role: "client" }, error: null })
      expect(passesThrough(await middleware(request(pathname)))).toBe(true)
    }
  )

  it.each(trainerRoutes)("a client on the coach route %s is sent to their own home", async (route) => {
    session({ id: "user-8" })
    profile({ data: { role: "client" }, error: null })
    expect(redirectsTo(await middleware(request(route)))?.pathname).toBe("/client")
    expect(redirectsTo(await middleware(request(`${route}/anything`)))?.pathname).toBe("/client")
  })

  it.each(["/client", "/client/training"])("a trainer on the client route %s is sent to the dashboard", async (pathname) => {
    session({ id: "user-7" })
    profile({ data: { role: "trainer" }, error: null })
    expect(redirectsTo(await middleware(request(pathname)))?.pathname).toBe("/dashboard")
  })

  it("a coach route's prefix is a whole segment: /clientside is neither route", async () => {
    session({ id: "user-8" })
    profile({ data: { role: "client" }, error: null })
    expect(passesThrough(await middleware(request("/clientside")))).toBe(true)
    expect(passesThrough(await middleware(request("/dashboards")))).toBe(true)
  })

  it.each([
    ["no profile row", { data: null, error: null }],
    ["a failed read", { data: null, error: { message: "connection refused" } }],
    ["a row with no role", { data: { role: "" }, error: null }],
  ] as const)("a session with %s fails closed: /login?error=profile_unavailable, never a role", async (_label, result) => {
    session({ id: "user-7" })
    profile(result as { data: { role: string } | null; error: unknown })
    const target = redirectsTo(await middleware(request("/dashboard")))
    expect(target?.pathname).toBe("/login")
    expect(target?.searchParams.get("error")).toBe("profile_unavailable")
    expect(redirectsTo(await middleware(request("/client")))?.searchParams.get("error")).toBe("profile_unavailable")
    expect(console.error).toHaveBeenCalledWith("Profile lookup failed for authenticated user:", "user-7")
  })

  it.each(["/", "/login", "/signup"])("a signed-in trainer on %s is sent to the dashboard, by a role read through the server", async (pathname) => {
    const { sessionFrom } = session({ id: "user-7" })
    const read = profile({ data: { role: "trainer" }, error: null })
    expect(redirectsTo(await middleware(request(pathname)))?.pathname).toBe("/dashboard")
    expect(read.from).toHaveBeenCalledWith("profiles")
    expect(read.eq).toHaveBeenCalledWith("user_id", "user-7")
    expect(sessionFrom).not.toHaveBeenCalled()
  })

  it.each(["/", "/login", "/signup"])("a signed-in client on %s is sent to their home", async (pathname) => {
    session({ id: "user-8" })
    profile({ data: { role: "client" }, error: null })
    expect(redirectsTo(await middleware(request(pathname)))?.pathname).toBe("/client")
  })

  it.each([
    ["no profile row", { data: null, error: null }],
    ["a failed read", { data: null, error: { message: "connection refused" } }],
    ["a row with no role", { data: { role: "" }, error: null }],
  ] as const)("a signed-in visitor with %s on a public page sees the page: no guessed home", async (_label, result) => {
    for (const pathname of ["/", "/login", "/signup", "/login?error=profile_unavailable"]) {
      session({ id: "user-7" }, [{ name: "sb-test-auth-token", value: "rotated" }])
      const read = profile(result as { data: { role: string } | null; error: unknown })
      const response = await middleware(request(pathname))
      expect(passesThrough(response)).toBe(true)
      // The pass-through is the cookie carrier, so a session rotated during getUser() is kept.
      expect(response.cookies.get("sb-test-auth-token")?.value).toBe("rotated")
      expect(read.eq).toHaveBeenCalledWith("user_id", "user-7")
    }
    expect(console.error).toHaveBeenCalledWith("Profile lookup failed for authenticated user:", "user-7")
  })

  it("the guarded branch's fail-closed answer is a page the public branch shows, so nothing loops", async () => {
    session({ id: "user-7" })
    profile({ data: null, error: { message: "connection refused" } })
    const sentTo = redirectsTo(await middleware(request("/dashboard")))
    expect(sentTo?.pathname).toBe("/login")
    expect(passesThrough(await middleware(request(`${sentTo!.pathname}${sentTo!.search}`)))).toBe(true)
  })

  it.each(["/", "/login", "/signup"])("%s with no session passes through, and the role is never read", async (pathname) => {
    session(null)
    const read = profile({ data: null, error: null })
    expect(passesThrough(await middleware(request(pathname)))).toBe(true)
    expect(read.from).not.toHaveBeenCalled()
  })

  it("a cookie the session rotated during getUser() rides on the redirect", async () => {
    session(null, [{ name: "sb-test-auth-token", value: "rotated" }])
    profile({ data: null, error: null })
    const response = await middleware(request("/dashboard"))
    expect(redirectsTo(response)?.pathname).toBe("/login")
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("rotated")

    session({ id: "user-8" }, [{ name: "sb-test-auth-token", value: "rotated-again" }])
    profile({ data: { role: "client" }, error: null })
    const roleRedirect = await middleware(request("/dashboard"))
    expect(redirectsTo(roleRedirect)?.pathname).toBe("/client")
    expect(roleRedirect.cookies.get("sb-test-auth-token")?.value).toBe("rotated-again")
  })

  it("marks a rotated cookie Secure over https and not over plain http", async () => {
    session({ id: "user-7" }, [{ name: "sb-test-auth-token", value: "r" }])
    profile({ data: { role: "trainer" }, error: null })
    const secure = await middleware(request("/dashboard", { "x-forwarded-proto": "https" }))
    expect(secure.cookies.get("sb-test-auth-token")?.secure).toBe(true)
    const plain = await middleware(request("/dashboard"))
    expect(plain.cookies.get("sb-test-auth-token")?.secure).toBeFalsy()
  })
})
