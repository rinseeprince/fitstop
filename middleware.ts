import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

/**
 * Redirect while preserving any cookies @supabase/ssr wrote onto `carrier`.
 *
 * The server client has autoRefreshToken disabled, so it rotates the session
 * lazily inside getUser() when the access token is within its expiry margin —
 * handing the new token to our setAll, which writes it onto the NextResponse.next()
 * we created up front. A bare NextResponse.redirect() is a DIFFERENT response
 * object, so returning one drops that cookie on the floor. Refresh tokens are
 * single-use and rotate, so the browser is then holding a token that has already
 * been spent: the user is silently logged out on a later request, at random, only
 * when a refresh happens to coincide with a redirect.
 */
function redirectPreservingCookies(url: URL, carrier: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url)
  for (const cookie of carrier.cookies.getAll()) {
    redirect.cookies.set(cookie)
  }
  return redirect
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Routes that skip auth entirely (no redirect for logged-in users)
  const skipAuthRoutes = [
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
  ]

  // Check-in routes are public (clients access via magic link)
  const isCheckInRoute = pathname.startsWith("/check-in/")

  // Check-in API routes are also public (for validating tokens and submitting check-ins)
  const isCheckInApiRoute = pathname.startsWith("/api/check-in/submit/")

  // Invitation routes are public (clients access via token-based invite links)
  const isInviteRoute = pathname.startsWith("/invite/")
  const isInviteApiRoute = pathname.startsWith("/api/invitations/")

  // Skip auth check entirely for these routes
  if (skipAuthRoutes.includes(pathname) || isCheckInRoute || isCheckInApiRoute || isInviteRoute || isInviteApiRoute) {
    return NextResponse.next()
  }

  // Mark the session cookie Secure over https (production) but not over plain
  // http (local dev), or the browser drops it and dev login breaks.
  const secureCookie = request.headers.get("x-forwarded-proto") === "https"

  // For homepage, login, and signup - check if user is authenticated and redirect to dashboard
  if (pathname === "/" || pathname === "/login" || pathname === "/signup") {
    const response = NextResponse.next()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, { ...options, secure: secureCookie })
            )
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      // User is logged in, redirect to appropriate dashboard
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single()

      const redirectTo = profile?.role === "client" ? "/client" : "/dashboard"
      return redirectPreservingCookies(new URL(redirectTo, request.url), response)
    }

    // Not logged in, allow access to public page
    return response
  }

  // Create a Supabase client for server-side auth check
  const response = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, { ...options, secure: secureCookie })
          )
        },
      },
    }
  )

  // Check if user is authenticated (getUser() validates JWT server-side, unlike getSession())
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // If no user and trying to access protected route, redirect to login.
  //
  // Deliberately no ?redirectTo= here. Nothing has ever read it (the login page
  // routes purely on the role returned by login(), /auth/callback builds every
  // redirect from a string literal), so it was a write-only parameter that
  // advertised a deep-link restore the app does not implement. Left in place it
  // is a trap: the next person to make it work is one raw
  // router.push(searchParams.get("redirectTo")) away from an open redirect,
  // since ?redirectTo=https://evil.com would then send a freshly authenticated
  // user to an attacker page. If deep-link restore is wanted later, reintroduce
  // this write together with a same-site validator on the read side.
  if (!user) {
    return redirectPreservingCookies(new URL("/login", request.url), response)
  }

  // Get user's role from profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  // If profile lookup failed or role is missing, deny access rather than
  // defaulting to an elevated role. A DB outage should not grant trainer access.
  if (!profile?.role) {
    console.error("Profile lookup failed for authenticated user:", user.id)
    const errorUrl = new URL("/login", request.url)
    errorUrl.searchParams.set("error", "profile_unavailable")
    return redirectPreservingCookies(errorUrl, response)
  }

  const role = profile.role
  const isClient = role === "client"
  const isTrainer = role === "trainer"

  // Client portal routes
  const isClientRoute =
    pathname.startsWith("/client/") || pathname === "/client"

  // Trainer-only routes
  const trainerRoutes = [
    "/dashboard",
    "/clients",
    "/check-ins",
    "/crm",
    "/messages",
    "/automation",
    "/email",
    "/settings",
  ]
  const isTrainerRoute = trainerRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  )

  // Role-based access control
  if (isClient && isTrainerRoute) {
    // Client trying to access trainer routes -> redirect to client home
    return redirectPreservingCookies(new URL("/client", request.url), response)
  }

  if (isTrainer && isClientRoute) {
    // Trainer trying to access client routes -> redirect to trainer dashboard
    return redirectPreservingCookies(new URL("/dashboard", request.url), response)
  }

  return response
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
     * on a trailing extension alone -- `.*\.(?:png|...)$` -- skipped middleware
     * for any path ending that way at any depth, and route segments are
     * wildcards: /clients/abc.png is app/clients/[id] with id="abc.png", so it
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
