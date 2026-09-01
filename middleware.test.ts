// @vitest-environment node
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info.js"
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher.js"
import type { ProxyMatcher } from "next/dist/build/analysis/get-page-static-info"
import type { MiddlewareRouteMatch } from "next/dist/shared/lib/router/utils/middleware-route-matcher"

import { config, trainerRoutes } from "./middleware"

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
  "/apple-icon.png",
  "/icon-dark-32x32.png",
  "/icon-light-32x32.png",
  "/icon.svg",
  "/placeholder-logo.png",
  "/placeholder-logo.svg",
  "/placeholder-user.jpg",
  "/placeholder.jpg",
  "/placeholder.svg",
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
