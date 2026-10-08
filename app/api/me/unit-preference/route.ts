import { type NextRequest, NextResponse } from "next/server";
import { captureApiError } from "@/lib/error-handler";
import { apiRateLimit } from "@/lib/rate-limit";
import { resolveViewerUnitPreference } from "@/lib/viewer-preferences";

/**
 * The authenticated viewer's own unit system. Serves BOTH roles — a coach gets
 * theirs, a client gets theirs — which is why it lives under /api/me rather
 * than /api/clients or /api/client.
 *
 * apiRateLimit (60/min/IP), not authRateLimit: this is a per-app-load bootstrap
 * GET for every logged-in user, so the auth tier would lock out normal usage —
 * the same reasoning as /api/auth/me.
 *
 * Deliberately NOT under /api/auth/me/**: the coach's preference is already
 * cached client-side under that key, and a §7 area-prefix invalidator for
 * /api/auth/me would then match this key too (and vice versa), collapsing two
 * caches that must be invalidated independently.
 *
 * Uses the THROWING resolver, not getViewerUnitPreference: a route can surface
 * a failure to its caller, so it must, rather than serving a guessed unit under
 * a 200 that no client can tell apart from a real answer.
 *
 * 401 on an unresolved principal: a session with no coach or client row behind
 * it, which the paths that make a login never leave (services/login-service.ts
 * writes the rows with the login). A coach's preference arrives on
 * /api/auth/me anyway, so a coach never depends on this endpoint.
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const preference = await resolveViewerUnitPreference(request);

    if (!preference) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: true, data: { preference } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    captureApiError(error, { route: "/api/me/unit-preference" });
    return NextResponse.json(
      { success: false, error: "Failed to load unit preference" },
      { status: 500 }
    );
  }
}
