import { NextRequest, NextResponse } from "next/server";
import {
  aiRateLimit,
  apiRateLimit,
  authRateLimit,
  checkInRateLimit,
  clientApiRateLimit,
  clientPerClientRateLimit,
} from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";

type RateLimitTier = "client" | "api" | "checkIn" | "ai" | "auth";

interface Options {
  rateLimit?: RateLimitTier;
  userId?: string;
}

type AuthOk = { ok: true; clientId: string };
type AuthFail = { ok: false; response: Response };

type ClientAuthResult = AuthOk | AuthFail;

/**
 * Runs the §8 auth chain for client-portal routes: rate limit → CSRF → auth.
 *
 * Returns the authenticated clientId on success. Callers are STILL responsible
 * for step 4 of §8 — verifying ownership of any resource identified by URL
 * params or request body. Auth proves identity, not permission.
 *
 * Defaults to clientApiRateLimit. Override via `{ rateLimit: "ai" | ... }`.
 *
 * The tight per-client tier (clientPerClientRateLimit) ALWAYS composes on top
 * of any `options.rateLimit` override — the override only swaps the pre-auth
 * (first) tier; it never replaces the post-auth per-client control.
 */
export async function requireClientAuth(
  request: NextRequest,
  options: Options = {},
): Promise<ClientAuthResult> {
  const rateLimitResponse = await runRateLimit(request, options);
  if (rateLimitResponse) return { ok: false, response: rateLimitResponse };

  const csrfResponse = await requireCSRFProtection(request);
  if (csrfResponse) return { ok: false, response: csrfResponse };

  const clientId = await getAuthenticatedClientId(request);
  if (!clientId) return { ok: false, response: unauthorized() };

  const perClient = await clientPerClientRateLimit(request, clientId);
  if (perClient) return { ok: false, response: perClient };

  return { ok: true, clientId };
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
