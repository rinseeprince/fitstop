import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsHistory } from "@/services/client-goals-service";

/**
 * The client's superseded goal versions, newest first.
 *
 * A SIBLING of `GET …/goals` rather than a `?history=true` flag on it. That flag
 * existed and switched the response's `data` between `ClientGoal | null` and
 * `{ current, history }` — unreachable in the running app, but three typed
 * readers assumed the former (`hooks/use-client-goals.ts`, the Metrics page, and
 * the drawer editor since deleted), so flipping it on would have broken them
 * silently. A separate route is additive and breaks no reader; the flag is gone.
 *
 * The response carries ONLY superseded versions — the live goal comes from the
 * sibling GET, and returning it in both is what made the old branch report the
 * current goal twice.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const history = await getGoalsHistory(clientId);

    return NextResponse.json(
      { success: true, data: history },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching goal history:", error);
    return NextResponse.json(
      { error: "Failed to fetch goal history" },
      { status: 500 }
    );
  }
}
