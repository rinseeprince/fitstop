import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getCheckInById } from "@/services/check-in-service";
import { getClientById } from "@/services/client-service";
import { supabaseAdmin } from "@/services/supabase-admin";

type Authorized = { authorized: true; coachId: string };
type Unauthorized = { authorized: false; response: NextResponse };
type CoachAuthResult = Authorized | Unauthorized;

/**
 * Requires coach authentication. Returns coachId or a 401 response.
 * Pass the route's request so auth failures log route + hashed IP.
 */
export async function requireCoachAuth(request?: NextRequest): Promise<CoachAuthResult> {
  const coachId = await getAuthenticatedCoachId(request);
  if (!coachId) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { authorized: true, coachId };
}

/**
 * Verifies that a client belongs to the authenticated coach.
 * Returns 401 if not authenticated, 404 if client not found or not owned.
 */
export async function requireCoachOwnsClient(
  clientId: string,
  request?: NextRequest
): Promise<CoachAuthResult> {
  const auth = await requireCoachAuth(request);
  if (!auth.authorized) return auth;

  const client = await getClientById(clientId);
  if (!client || client.coachId !== auth.coachId) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      ),
    };
  }
  return auth;
}

/**
 * Verifies that a check-in belongs to a client owned by the authenticated coach.
 * Returns the check-in data if authorized.
 */
export async function requireCoachOwnsCheckIn(checkInId: string): Promise<
  | { authorized: true; coachId: string; checkIn: NonNullable<Awaited<ReturnType<typeof getCheckInById>>> }
  | Unauthorized
> {
  const auth = await requireCoachAuth();
  if (!auth.authorized) return auth;

  const checkIn = await getCheckInById(checkInId);
  if (!checkIn) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      ),
    };
  }

  const client = await getClientById(checkIn.clientId);
  if (!client || client.coachId !== auth.coachId) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      ),
    };
  }

  return { authorized: true, coachId: auth.coachId, checkIn };
}

/**
 * Gets all client IDs belonging to the authenticated coach.
 * Useful for scoping bulk queries. Throws on database errors.
 */
export async function getCoachClientIds(
  coachId: string
): Promise<string[]> {
  const { data: clients, error } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("coach_id", coachId)
    .eq("active", true);

  if (error) {
    throw new Error("Failed to fetch coach clients");
  }

  return (clients || []).map((c) => c.id);
}
