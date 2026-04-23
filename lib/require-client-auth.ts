import { NextRequest, NextResponse } from "next/server";
import {
  aiRateLimit,
  apiRateLimit,
  authRateLimit,
  checkInRateLimit,
  clientApiRateLimit,
} from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  getAuthenticatedClientId,
  getAuthenticatedClientWithCheckInDay,
} from "@/lib/auth-helpers";

type RateLimitTier = "client" | "api" | "checkIn" | "ai" | "auth";

interface Options {
  rateLimit?: RateLimitTier;
  userId?: string;
}

type AuthOk = { ok: true; clientId: string };
type AuthOkWithCheckInDay = {
  ok: true;
  clientId: string;
  checkInDay: string | null;
};
type AuthFail = { ok: false; response: Response };

export type ClientAuthResult = AuthOk | AuthFail;
export type ClientAuthWithCheckInDayResult = AuthOkWithCheckInDay | AuthFail;

/**
 * Runs the §8 auth chain for client-portal routes: rate limit → CSRF → auth.
 *
 * Returns the authenticated clientId on success. Callers are STILL responsible
 * for step 4 of §8 — verifying ownership of any resource identified by URL
 * params or request body. Auth proves identity, not permission.
 *
 * Defaults to clientApiRateLimit. Override via `{ rateLimit: "ai" | ... }`.
 */
export async function requireClientAuth(
  request: NextRequest,
  options: Options = {},
): Promise<ClientAuthResult> {
  const rateLimitResponse = await runRateLimit(request, options);
  if (rateLimitResponse) return { ok: false, response: rateLimitResponse };

  const csrfResponse = await requireCSRFProtection(request);
  if (csrfResponse) return { ok: false, response: csrfResponse };

  const clientId = await getAuthenticatedClientId();
  if (!clientId) return { ok: false, response: unauthorized() };

  return { ok: true, clientId };
}

/**
 * Variant that also returns the client's expected check-in day.
 * Used by training-related routes that compute week boundaries from it.
 */
export async function requireClientAuthWithCheckInDay(
  request: NextRequest,
  options: Options = {},
): Promise<ClientAuthWithCheckInDayResult> {
  const rateLimitResponse = await runRateLimit(request, options);
  if (rateLimitResponse) return { ok: false, response: rateLimitResponse };

  const csrfResponse = await requireCSRFProtection(request);
  if (csrfResponse) return { ok: false, response: csrfResponse };

  const authed = await getAuthenticatedClientWithCheckInDay();
  if (!authed) return { ok: false, response: unauthorized() };

  return { ok: true, clientId: authed.clientId, checkInDay: authed.checkInDay };
}

async function runRateLimit(
  request: NextRequest,
  options: Options,
): Promise<NextResponse | null> {
  const tier: RateLimitTier = options.rateLimit ?? "client";
  switch (tier) {
    case "api":
      return apiRateLimit(request);
    case "checkIn":
      return checkInRateLimit(request);
    case "ai":
      return aiRateLimit(request, options.userId);
    case "auth":
      return authRateLimit(request);
    case "client":
      return clientApiRateLimit(request);
  }
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Unauthorized" },
    { status: 401 },
  );
}
