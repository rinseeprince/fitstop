import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { clientLayoutSchema } from "@/lib/validations/training";
import {
  applyClientLayout,
  LayoutDriftError,
  LayoutNotFoundError,
  LayoutPolicyError,
} from "@/services/training-event-layout-service";
import { DateOccupiedError } from "@/services/training-event-occupancy";

/**
 * POST — apply a week layout to the client's own calendar: N still-scheduled
 * sessions change date in one transaction (migration 150). A single move, a
 * two-day swap and a whole-week rearrangement are the same request at
 * different sizes. Nutrition follows the moved sessions (one cascade).
 *
 * requireClientAuth: IP burst guard → CSRF → auth → per-client tier (§9). The
 * service scopes every read and the RPC every write on the authed clientId, so
 * a foreign eventId reads as not found (404), never as someone else's.
 *
 * 409 carries a sentence the client can act on — either the day is taken
 * ("Sat, Aug 29 already has a session") or their week changed under them and
 * they should reload. 400 is a rule of their own calendar (week bound, a past
 * day already logged, a logged session).
 */
export async function POST(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: "Malformed JSON" },
      { status: 400 },
    );
  }

  const parsed = clientLayoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const data = await applyClientLayout(auth.clientId, parsed.data.moves);
    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    if (error instanceof DateOccupiedError || error instanceof LayoutDriftError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    if (error instanceof LayoutPolicyError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (error instanceof LayoutNotFoundError) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    console.error("Error applying client layout:", error);
    return NextResponse.json(
      { success: false, error: "Failed to move sessions" },
      { status: 500 },
    );
  }
}
