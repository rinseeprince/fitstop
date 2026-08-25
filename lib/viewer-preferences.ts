import type { NextRequest } from "next/server";
import {
  getAuthenticatedClientId,
  getAuthenticatedCoachId,
} from "@/lib/auth-helpers";
import { captureApiError } from "@/lib/error-handler";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  DEFAULT_UNIT_SYSTEM,
  toUnitSystem,
  type UnitSystem,
} from "@/utils/unit-conversions";

/**
 * Server-side resolution of the VIEWER's unit system.
 *
 * A coach has their own preference and a client has theirs; neither can change
 * the other's. Storage stays canonical kg/cm either way — this only decides
 * what a given person is shown (CONVENTIONS.md §20 Units).
 *
 * The two exports below have DELIBERATELY DIFFERENT failure contracts. Read
 * both before picking one.
 */

/**
 * A resolved id whose row is gone returns null rather than throwing: the auth
 * cache holds a user → coach/client mapping for 60s (lib/auth-cache.ts), so a
 * row deleted inside that window is a real, non-exceptional race. Callers treat
 * it exactly like "no principal", which is what `auth-helpers` itself does when
 * the profile row is missing.
 */
async function readCoachPreference(coachId: string): Promise<UnitSystem | null> {
  const { data, error } = await supabaseAdmin
    .from("coaches")
    .select("unit_preference")
    .eq("id", coachId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read coach unit preference: ${error.message}`);
  }
  if (!data) return null;

  return toUnitSystem(data.unit_preference);
}

async function readClientPreference(clientId: string): Promise<UnitSystem | null> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("unit_preference")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read client unit preference: ${error.message}`);
  }
  if (!data) return null;

  return toUnitSystem(data.unit_preference);
}

/**
 * Resolve the authenticated principal to their unit system.
 *
 * - `null` means there is no authenticated principal (or their row has since
 *   been deleted) — the caller decides, and an API route should 401.
 * - **Throws** on a database error. It never substitutes a default, because a
 *   guessed unit served with a 200 is indistinguishable from a real answer:
 *   the caller would render lbs to a metric viewer with no signal that anything
 *   failed.
 *
 * Coach-first: the coach surface is the primary app and Phase 3's server-side
 * consumers (AI prompt strings, calculator warnings) are coach-facing, so it is
 * the branch worth resolving in one hop. A client caller pays an extra
 * getUser() + an uncached coaches miss first; acceptable at one request per app
 * load, and the order is a one-line change if that stops being true.
 *
 * `request` is always passed through so auth failures log route + hashed IP.
 */
export async function resolveViewerUnitPreference(
  request: NextRequest
): Promise<UnitSystem | null> {
  const coachId = await getAuthenticatedCoachId(request);
  if (coachId) return readCoachPreference(coachId);

  const clientId = await getAuthenticatedClientId(request);
  if (clientId) return readClientPreference(clientId);

  return null;
}

/**
 * Lossy variant: always answers with a unit system, falling back to metric when
 * the viewer cannot be resolved OR when the read fails.
 *
 * DELIBERATELY different from `resolveViewerUnitPreference` above. Use this
 * ONLY for server-rendered human-readable text — the AI prompt strings in
 * `utils/ai-prompt-builder.ts` and the calculator warnings in
 * `services/nutrition-service.ts` — where there is no UI state to degrade into
 * and the string has to say something. Anything that can surface an error to
 * the caller (every API route) must use the throwing variant instead, or it
 * reintroduces the silent-wrong-answer shape this split exists to remove.
 */
export async function getViewerUnitPreference(
  request: NextRequest
): Promise<UnitSystem> {
  try {
    return (await resolveViewerUnitPreference(request)) ?? DEFAULT_UNIT_SYSTEM;
  } catch (error) {
    captureApiError(error, { helper: "getViewerUnitPreference" });
    return DEFAULT_UNIT_SYSTEM;
  }
}

/**
 * A specific coach's unit system, for server-rendered text that a COACH reads
 * but that is not necessarily generated on a coach-authenticated request.
 *
 * The AI check-in summary is the case this exists for. It has two call paths:
 * the coach's own regenerate route, and a fire-and-forget trigger on the
 * CLIENT's submit route. `getViewerUnitPreference(request)` is wrong on the
 * second — it would resolve the client, and the coach would then read a summary
 * in whichever unit happened to generate it. The reader is the coach either way,
 * so resolve the reader.
 *
 * Falls back to metric rather than throwing: this only ever decorates prose.
 */
export async function getCoachUnitPreference(
  coachId: string | null | undefined
): Promise<UnitSystem> {
  if (!coachId) return DEFAULT_UNIT_SYSTEM;
  try {
    return (await readCoachPreference(coachId)) ?? DEFAULT_UNIT_SYSTEM;
  } catch (error) {
    captureApiError(error, { helper: "getCoachUnitPreference" });
    return DEFAULT_UNIT_SYSTEM;
  }
}
