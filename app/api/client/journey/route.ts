import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientTodayString } from "@/services/today-service";
import { getClientJourney } from "@/services/client-journey-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // The client's calendar day, resolved once here and threaded down — the
    // service never derives time (the blocks-routes precedent).
    const clientToday = await getClientTodayString(auth.clientId);
    const data = await getClientJourney(auth.clientId, clientToday);
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching client journey:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch journey" },
      { status: 500 }
    );
  }
}
