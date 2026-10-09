import { NextRequest } from "next/server";
import { headers } from "next/headers";

/** The scheme Better Auth's bearer plugin reads a session token under, in any case. */
const BEARER_SCHEME = "bearer ";

/**
 * Whether the request carries a bearer token as Better Auth's bearer plugin
 * reads one: the scheme, in any case, then a token. A browser sends no bearer
 * token of its own, and a page on another site could make it send one only
 * through a CORS preflight the app would have to approve, and it approves
 * none, so such a request was made by code that holds the token: the client
 * app (docs/BETTER-AUTH-PLAN.md 2.8). Whose session the token names stays
 * Better Auth's to say, where the proxy and the auth seam read it. A token
 * that names none is no session: the request is then signed out (the proxy's
 * 401), or signed in by a cookie sent beside it, which only code, never a
 * browser, sends with no Origin.
 */
function carriesBearerToken(authorization: string | null): boolean {
  if (!authorization || authorization.slice(0, BEARER_SCHEME.length).toLowerCase() !== BEARER_SCHEME) return false;
  return authorization.slice(BEARER_SCHEME.length).trim() !== "";
}

/**
 * Simple CSRF protection for API routes
 * Verifies that requests come from the same origin
 */
async function validateCSRFToken(request: NextRequest): Promise<boolean> {
  // Allow GET requests (they should be idempotent)
  if (request.method === "GET") {
    return true;
  }

  try {
    const headersList = await headers();
    const origin = headersList.get("origin");
    const referer = headersList.get("referer");
    const host = headersList.get("host");

    // Build expected origin from protocol + host for exact match
    const proto = headersList.get("x-forwarded-proto") || "https";
    const expectedOrigin = `${proto}://${host}`;

    // If we have an origin header, verify exact match (protocol + host)
    if (origin) {
      if (origin !== expectedOrigin) {
        console.warn(`CSRF: Origin ${origin} doesn't match expected ${expectedOrigin}`);
        return false;
      }
      return true;
    }

    // Fallback to referer check (protocol + host must match)
    if (referer) {
      const refererUrl = new URL(referer);
      const refererOrigin = refererUrl.origin;
      if (refererOrigin !== expectedOrigin) {
        console.warn(`CSRF: Referer origin ${refererOrigin} doesn't match expected ${expectedOrigin}`);
        return false;
      }
      return true;
    }

    // Neither header: no browser sent it, since a browser names its site in
    // Origin on every POST, PUT, PATCH and DELETE. The client app's bearer
    // request passes; any other is refused.
    if (carriesBearerToken(headersList.get("authorization"))) {
      return true;
    }
    console.warn("CSRF: No origin or referer header found");
    return false;

  } catch (error) {
    console.error("CSRF validation error:", error);
    return false;
  }
}

/**
 * CSRF protection middleware for API routes
 * Call this at the start of POST, PUT, PATCH, DELETE handlers
 */
export async function requireCSRFProtection(request: NextRequest): Promise<Response | null> {
  const isValid = await validateCSRFToken(request);
  
  if (!isValid) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "CSRF validation failed" 
      }),
      { 
        status: 403,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  return null; // No error, continue processing
}