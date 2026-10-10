import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientTodayString } from "@/services/today-service";
import { getClientGoalWire } from "@/services/client-goal-wire-service";

// GET - The client's goal card on the Program tab: the goal in force on the
// client's today, with the readings its progress is judged from.
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // The client's calendar day, resolved once here and handed down — the
    // service never derives time.
    const clientToday = await getClientTodayString(auth.clientId);
    const data = await getClientGoalWire(auth.clientId, clientToday);
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching the client's goal:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch goal" },
      { status: 500 }
    );
  }
}
