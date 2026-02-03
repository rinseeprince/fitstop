import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Routes that skip auth entirely (no redirect for logged-in users)
  const skipAuthRoutes = [
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
    "/client/onboarding",
  ]

  // Check-in routes are public (clients access via magic link)
  const isCheckInRoute = pathname.startsWith("/check-in/")

  // Check-in API routes are also public (for validating tokens and submitting check-ins)
  const isCheckInApiRoute = pathname.startsWith("/api/check-in/submit/")

  // Skip auth check entirely for these routes
  if (skipAuthRoutes.includes(pathname) || isCheckInRoute || isCheckInApiRoute) {
    return NextResponse.next()
  }

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
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { session } } = await supabase.auth.getSession()

    if (session) {
      // User is logged in, redirect to appropriate dashboard
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", session.user.id)
        .single()

      const redirectTo = profile?.role === "client" ? "/client/dashboard" : "/dashboard"
      return NextResponse.redirect(new URL(redirectTo, request.url))
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
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Check if user is authenticated
  const {
    data: { session },
  } = await supabase.auth.getSession()

  // If no session and trying to access protected route, redirect to login
  if (!session) {
    const redirectUrl = new URL("/login", request.url)
    redirectUrl.searchParams.set("redirectTo", pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // Get user's role from profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", session.user.id)
    .single()

  const role = profile?.role || "trainer" // Default to trainer for backwards compatibility
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
    // Client trying to access trainer routes -> redirect to client dashboard
    return NextResponse.redirect(new URL("/client/dashboard", request.url))
  }

  if (isTrainer && isClientRoute) {
    // Trainer trying to access client routes -> redirect to trainer dashboard
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
