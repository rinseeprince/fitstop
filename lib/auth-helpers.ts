import { createHash } from "crypto";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { readSessionUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getCachedClientId, getCachedCoachId } from "@/lib/auth-cache";

type AuthFailureReason =
  | "missing_session"
  | "invalid_session"
  | "db_error"
  | "coach_profile_not_found"
  | "client_profile_not_found";

/**
 * Emit a structured auth-failure log. Called on every 401-equivalent path
 * in this module so a probe campaign is visible in local logs / Sentry
 * breadcrumbs. Intentionally never logs PII (no user_id, no email, no
 * session token). IPs are hashed via SHA-256 so repeated failures from
 * the same source group without revealing the address.
 *
 * `route` and `ipHash` fall back to "unknown" when no `request` is passed
 * (coach-side callers don't thread it yet — see TECHNICAL-DEBT H2 #1).
 */
function logAuthFailure(opts: {
  role: "coach" | "client";
  reason: AuthFailureReason;
  request?: NextRequest;
}): void {
  const { role, reason, request } = opts;
  let route = "unknown";
  let ipHash = "unknown";

  if (request) {
    route = request.nextUrl.pathname;
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim();
    if (ip) {
      ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 12);
    }
  }

  console.warn("auth_failure", {
    timestamp: new Date().toISOString(),
    role,
    reason,
    route,
    ipHash,
  });
}

/**
 * The user id of the request's session, or null with the reason logged:
 * Better Auth reads the session the cookie or a bearer token names
 * (`readSessionUserId`, lib/auth.ts). The request's own headers when the
 * route passes it, else the incoming request's through `headers()`.
 */
async function sessionUserId(
  role: "coach" | "client",
  request?: NextRequest
): Promise<string | null> {
  let userId: string | null;
  try {
    userId = await readSessionUserId(request?.headers ?? (await headers()));
  } catch (error) {
    console.error("Session read failed:", error);
    logAuthFailure({ role, reason: "invalid_session", request });
    return null;
  }
  if (!userId) logAuthFailure({ role, reason: "missing_session", request });
  return userId;
}

/**
 * Gets the authenticated coach ID from the current session: Better Auth
 * validates the session, and the coaches row is read by its user id.
 * @param request Optional NextRequest used for structured auth-failure logging
 *   (route + hashed IP). Coach-side callers can omit it; failures will log
 *   "unknown" for route/IP but still record the reason and timestamp.
 * @returns The coach ID if authenticated, null otherwise.
 */
export async function getAuthenticatedCoachId(
  request?: NextRequest
): Promise<string | null> {
  try {
    const userId = await sessionUserId("coach", request);
    if (!userId) return null;

    return await getCachedCoachId(userId, async () => {
      // Use maybeSingle() to avoid throwing PGRST116 when no coach found
      const { data: coach, error } = await supabaseAdmin
        .from("coaches")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching coach:", error.message);
        logAuthFailure({ role: "coach", reason: "db_error", request });
        return null;
      }

      if (!coach?.id) {
        logAuthFailure({ role: "coach", reason: "coach_profile_not_found", request });
        return null;
      }

      return coach.id;
    });
  } catch (error) {
    console.error("Unexpected error in getAuthenticatedCoachId:", error);
    return null;
  }
}

/**
 * Gets the authenticated client ID from the current session: Better Auth
 * validates the session, and the clients row is read by its user id, active
 * clients only.
 * @param request Optional NextRequest used for structured auth-failure logging.
 * @returns The client ID if authenticated as a client, null otherwise.
 */
export async function getAuthenticatedClientId(
  request?: NextRequest
): Promise<string | null> {
  try {
    const userId = await sessionUserId("client", request);
    if (!userId) return null;

    const clientId = await getCachedClientId(userId, async () => {
      // Use maybeSingle() to avoid throwing PGRST116 when no client found.
      // active=true excludes deactivated clients (H6); the cache is busted on
      // deactivation so a previously-cached mapping cannot outlive it past the TTL.
      const { data: client, error } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("user_id", userId)
        .eq("active", true)
        .maybeSingle();

      if (error) {
        console.error("Error fetching client:", error.message);
        logAuthFailure({ role: "client", reason: "db_error", request });
        return null;
      }

      if (!client?.id) {
        logAuthFailure({ role: "client", reason: "client_profile_not_found", request });
        return null;
      }

      return client.id;
    });

    if (!clientId) return null;
    return clientId;
  } catch (error) {
    console.error("Unexpected error in getAuthenticatedClientId:", error);
    return null;
  }
}
