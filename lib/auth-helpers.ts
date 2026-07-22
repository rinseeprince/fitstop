import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  getCachedClientId,
  getCachedClientWithCheckInDay,
} from "@/lib/auth-cache";

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
 * JWT contents). IPs are hashed via SHA-256 so repeated failures from
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
 * Gets the authenticated coach ID from the current session.
 * @param request Optional NextRequest used for structured auth-failure logging
 *   (route + hashed IP). Coach-side callers can omit it; failures will log
 *   "unknown" for route/IP but still record the reason and timestamp.
 * @returns The coach ID if authenticated, null otherwise.
 */
export async function getAuthenticatedCoachId(
  request?: NextRequest
): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      logAuthFailure({ role: "coach", reason: "invalid_session", request });
      return null;
    }
    if (!user) {
      logAuthFailure({ role: "coach", reason: "missing_session", request });
      return null;
    }

    // Use maybeSingle() to avoid throwing PGRST116 when no coach found
    const { data: coach, error } = await supabase
      .from("coaches")
      .select("id")
      .eq("user_id", user.id)
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
  } catch (error) {
    console.error("Unexpected error in getAuthenticatedCoachId:", error);
    return null;
  }
}

/**
 * Gets the authenticated client ID from the current session.
 * @param request Optional NextRequest used for structured auth-failure logging.
 * @returns The client ID if authenticated as a client, null otherwise.
 */
export async function getAuthenticatedClientId(
  request?: NextRequest
): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      logAuthFailure({ role: "client", reason: "invalid_session", request });
      return null;
    }
    if (!user) {
      logAuthFailure({ role: "client", reason: "missing_session", request });
      return null;
    }

    const clientId = await getCachedClientId(user.id, async () => {
      // Use maybeSingle() to avoid throwing PGRST116 when no client found.
      // active=true excludes deactivated clients (H6); the cache is busted on
      // deactivation so a previously-cached mapping cannot outlive it past the TTL.
      const { data: client, error } = await supabase
        .from("clients")
        .select("id")
        .eq("user_id", user.id)
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

/**
 * Gets the authenticated client ID and check-in day from the current session.
 * Used by training-related routes that need the client's check-in day
 * to compute correct training week boundaries.
 * @param request Optional NextRequest used for structured auth-failure logging.
 */
export async function getAuthenticatedClientWithCheckInDay(
  request?: NextRequest
): Promise<{
  clientId: string;
  checkInDay: string | null;
} | null> {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      logAuthFailure({ role: "client", reason: "invalid_session", request });
      return null;
    }
    if (!user) {
      logAuthFailure({ role: "client", reason: "missing_session", request });
      return null;
    }

    return await getCachedClientWithCheckInDay(user.id, async () => {
      // active=true excludes deactivated clients (H6) — see getAuthenticatedClientId.
      const { data: client, error } = await supabase
        .from("clients")
        .select("id, expected_check_in_day")
        .eq("user_id", user.id)
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

      return {
        clientId: client.id,
        checkInDay: client.expected_check_in_day ?? null,
      };
    });
  } catch (error) {
    console.error("Unexpected error in getAuthenticatedClientWithCheckInDay:", error);
    return null;
  }
}
