import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/auth"

/**
 * Better Auth's whole surface: sign-in, sign-out, the session and every other
 * endpoint of lib/auth.ts, under /api/auth (docs/BETTER-AUTH-PLAN.md 2.2).
 * Better Auth runs its own chain: its limiter (better_auth."rateLimit", on in
 * production), its origin check (a POST carrying any cookie must come from a
 * trusted origin; a sign-in or sign-up is also refused when it names another
 * origin or arrives as another site's form) and its own answers, its
 * unexpected errors reported to Sentry. /api/auth/me is a more specific
 * segment, so Next routes it to its own file, never here. The middleware
 * leaves the prefix to these routes: they are reached signed out.
 */
export const { GET, POST } = toNextJsHandler(auth)
