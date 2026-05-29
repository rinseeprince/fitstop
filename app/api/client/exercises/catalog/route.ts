import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getExerciseCatalogDelta } from "@/services/exercise-catalog-service";
import { isValidIsoTimestamp } from "@/lib/cursor";

// GET /api/client/exercises/catalog?since= — delta-sync feed for the native
// client's exercise catalog. Omit `since` for a full resync (cold start / the
// periodic reconciliation that catches deletes a delta can't see); pass the
// last-seen updated_at to fetch only what changed after it.
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("coach_id")
      .eq("id", auth.clientId)
      .single();

    if (clientError || !client?.coach_id) {
      return NextResponse.json(
        { success: false, error: "Client profile not found" },
        { status: 404 },
      );
    }

    // Normalize an empty `since` (e.g. a native client appending
    // `?since=${lastSeen || ""}` on cold start) to a full resync, matching the
    // documented omit-for-full-resync contract instead of rejecting it as 400.
    const sinceParam = new URL(request.url).searchParams.get("since");
    const since = sinceParam ? sinceParam : undefined;
    if (since !== undefined && !isValidIsoTimestamp(since)) {
      return NextResponse.json(
        { success: false, error: "Invalid since" },
        { status: 400 },
      );
    }

    const exercises = await getExerciseCatalogDelta(client.coach_id, since);

    return NextResponse.json(
      { success: true, exercises },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error fetching exercise catalog:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch exercise catalog" },
      { status: 500 },
    );
  }
}
