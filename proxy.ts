import { NextResponse, type NextRequest } from "next/server"
// The proxy runs on Node (Next 16's proxy file convention), so Better Auth's
// session read and the service-role client run here as they do in a route.
// Neither reaches the browser: `npm run check:service-key` scans the browser
// bundle for their secrets, and `npm run build` is the gate that compiles
// this file.
import { readSessionUserId } from "@/lib/auth"
import { supabaseAdmin } from "@/services/supabase-admin"
import { LOGIN_ERROR_PROFILE_UNAVAILABLE, RESET_PASSWORD_PAGE, SET_PASSWORD_PAGE } from "@/lib/constants"

/**
 * The trainer-only route prefixes — the authorization half of the coach
 * boundary. The filesystem half is app/(coach)/, and proxy.test.ts binds the
 * two in both directions: every top-level folder there is listed here, and
 * every entry here is a folder there. It has to be a literal: Next's own route
 * manifest is a build output, and the proxy is compiled apart from the routes,
 * so neither can be read from here.
 */
export const trainerRoutes = [
  "/dashboard",
  "/clients",
  "/crm",
  "/automation",
  "/settings",
] as const

/**
 * Pages that skip auth entirely, matched exactly: the password reset's two,
 * and the page the owner's "Set your password" link lands on (rule 9).
 */
const PUBLIC_PAGES = ["/forgot-password", RESET_PASSWORD_PAGE, SET_PASSWORD_PAGE]

/**
 * Prefixes that skip auth entirely, each answering for itself: the invite page
 * and its API (the token is the credential), and /api/auth/, Better Auth's
 * endpoints (app/api/auth/[...all]), which are reached signed out, signing in
 * being one of them, with the app's /api/auth/me, which answers its own 401.
 * A prefix lets through whatever is added beneath it, so proxy.test.ts holds
 * app/api/auth/ to exactly those two routes.
 */
const PUBLIC_PREFIXES = ["/invite/", "/api/invitations/", "/api/auth/"]

// NOTE: /check-in/* and /api/check-in/submit/* used to skip auth here, for the
// magic-link check-in flow deleted in migration 142. Both predicates matched by
// PREFIX, so leaving them would have let any future route under those paths
// bypass the proxy's auth silently. Clients now check in through the
// authenticated portal (/client/check-in); do not re-add a public prefix here.

/** The pages a signed-in visitor is sent home from; a signed-out one sees them. */
const ENTRY_PAGES = ["/", "/login"]

const isApiPath = (pathname: string) => pathname === "/api" || pathname.startsWith("/api/")

/**
 * Who the request is signed in as. A session that cannot be read (a database
 * fault) counts as none, so the request fails closed; readSessionUserId has
 * sent the fault to Sentry.
 */
async function signedInUserId(request: NextRequest): Promise<string | null> {
  try {
    return await readSessionUserId(request.headers)
  } catch (error) {
    console.error("Session read failed:", error)
    return null
  }
}

/** The role from profiles, through the server, keyed on the session's user id; null when it cannot be read. */
async function readRole(userId: string): Promise<string | null> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .single()
  return profile?.role || null
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PAGES.includes(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next()
  }

  // The home page and the login page: a signed-in visitor goes to their home.
  if (ENTRY_PAGES.includes(pathname)) {
    const userId = await signedInUserId(request)
    if (!userId) return NextResponse.next()

    // When the role cannot be read (a failed read, no profile row) the page
    // shows instead: guessing /dashboard here sent them to a page whose own
    // check sent them back to /login, and the browser looped until it gave
    // up. The login page carries the message the guarded branch below sends
    // them with.
    const role = await readRole(userId)
    if (!role) {
      console.error("Profile lookup failed for authenticated user:", userId)
      return NextResponse.next()
    }
    return NextResponse.redirect(new URL(role === "client" ? "/client" : "/dashboard", request.url))
  }

  const userId = await signedInUserId(request)

  // No session: a page goes to the login page; an API answers 401 JSON, which
  // the client app can read, instead of the login page (rule 16).
  //
  // Deliberately no ?redirectTo= on the redirect. Nothing has ever read it (the
  // login page routes purely on the role returned by login()), so it was a
  // write-only parameter that advertised a deep-link restore the app does not
  // implement. Left in place it is a trap: the next person to make it work is
  // one raw router.push(searchParams.get("redirectTo")) away from an open
  // redirect, since ?redirectTo=https://evil.com would then send a freshly
  // authenticated user to an attacker page. If deep-link restore is wanted
  // later, reintroduce this write together with a same-site validator on the
  // read side.
  if (!userId) {
    if (isApiPath(pathname)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // If the role cannot be read, deny access rather than defaulting to an
  // elevated role. A database outage should not grant trainer access.
  const role = await readRole(userId)
  if (!role) {
    console.error("Profile lookup failed for authenticated user:", userId)
    const errorUrl = new URL("/login", request.url)
    errorUrl.searchParams.set("error", LOGIN_ERROR_PROFILE_UNAVAILABLE)
    return NextResponse.redirect(errorUrl)
  }

  const isClientRoute = pathname.startsWith("/client/") || pathname === "/client"
  const isTrainerRoute = trainerRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  )

  // Role-based access control
  if (role === "client" && isTrainerRoute) {
    // Client trying to access trainer routes -> redirect to client home
    return NextResponse.redirect(new URL("/client", request.url))
  }

  if (role === "trainer" && isClientRoute) {
    // Trainer trying to access client routes -> redirect to trainer dashboard
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except the ones static assets are actually
     * served from:
     * - _next/static (build output)
     * - _next/image (image optimizer)
     * - favicon.ico
     * - root-level files in /public with an image extension
     *
     * The asset exclusion is bound to WHERE assets live (the root of /public,
     * which has no nested folders), not to how a URL happens to end. Excluding
     * on a trailing extension alone -- `.*\.(?:png|...)$` -- skipped the proxy
     * for any path ending that way at any depth, and route segments are
     * wildcards: /clients/abc.png is app/(coach)/clients/[id] with id="abc.png", so it
     * rendered with no auth check and no role redirect. `[^/]+` cannot cross a
     * slash, so only a genuine root-level asset matches.
     *
     * favicon.ico is a single file, so its dot is escaped and it is anchored;
     * unescaped and unanchored it also excluded /faviconXico and
     * /favicon.ico-anything. _next/static and _next/image stay prefix matches
     * because they are directories.
     */
    "/((?!_next/static|_next/image|favicon\\.ico$|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
