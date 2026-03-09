import { NextRequest } from "next/server";
import { headers } from "next/headers";

/**
 * Simple CSRF protection for API routes
 * Verifies that requests come from the same origin
 */
export async function validateCSRFToken(request: NextRequest): Promise<boolean> {
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

    // No origin or referer - this might be suspicious
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