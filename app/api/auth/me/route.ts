import { createHash } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { apiRateLimit } from "@/lib/rate-limit";
import { readSessionUserId } from "@/lib/auth";
import { getProfileAndCoach } from "@/services/auth-profile-service";

/**
 * Session bootstrap for the browser AuthProvider. Serves BOTH roles: trainers
 * get `{ profile, coach }`, clients get `{ profile, coach: null }`. A pure
 * read, keyed on the user id of the session Better Auth validates.
 *
 * apiRateLimit (60/min/IP), not authRateLimit (5/15min): this fires on every
 * app load for every logged-in user, so the auth tier would lock out normal
 * usage.
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  let userId: string | null;
  let sessionReadFailed = false;
  try {
    userId = await readSessionUserId(request.headers);
  } catch (error) {
    console.error("GET /api/auth/me: session read failed:", error);
    userId = null;
    sessionReadFailed = true;
  }

  if (!userId) {
    // The proxy leaves /api/auth/ to its routes, so this is the answer a
    // signed-out request gets. Mirrors lib/auth-helpers' auth_failure log
    // shape (role unknown here — this endpoint resolves the role).
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim();
    console.warn("auth_failure", {
      timestamp: new Date().toISOString(),
      role: "unknown",
      reason: sessionReadFailed ? "invalid_session" : "missing_session",
      route: "/api/auth/me",
      ipHash: ip
        ? createHash("sha256").update(ip).digest("hex").slice(0, 12)
        : "unknown",
    });
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const data = await getProfileAndCoach(userId);
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("GET /api/auth/me failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load profile" },
      { status: 500 }
    );
  }
}
