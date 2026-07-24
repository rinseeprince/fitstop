import { createHash } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import { apiRateLimit } from "@/lib/rate-limit";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getOrCreateProfileAndCoach } from "@/services/auth-profile-service";

/**
 * Session bootstrap for the browser AuthProvider. Serves BOTH roles: trainers
 * get `{ profile, coach }`, clients get `{ profile, coach: null }`.
 *
 * apiRateLimit (60/min/IP), not authRateLimit (5/15min): this fires on every
 * app load for every logged-in user, so the auth tier would lock out normal
 * usage — same reasoning as the /auth/callback precedent.
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    // Defense-in-depth: middleware normally redirects unauthenticated /api
    // requests before this runs. Mirrors lib/auth-helpers' auth_failure log
    // shape (role unknown here — this endpoint resolves the role).
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim();
    console.warn("auth_failure", {
      timestamp: new Date().toISOString(),
      role: "unknown",
      reason: userError ? "invalid_session" : "missing_session",
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
    const data = await getOrCreateProfileAndCoach(user);
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
