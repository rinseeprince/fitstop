import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientHabitDay } from "@/services/client-habit-figures-service";
import { habitDate } from "@/lib/validations/client-habits";

/**
 * The client's habits on `date`: every habit a version covers that day,
 * planned or not — the client may make an entry on any of them — with the
 * day's target, the entry, the week holding the day and the words.
 */
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const date = new URL(request.url).searchParams.get("date");
  if (date === null) {
    return NextResponse.json({ success: false, error: "Missing required date parameter" }, { status: 400 });
  }
  if (!habitDate.safeParse(date).success) {
    return NextResponse.json({ success: false, error: "Invalid date" }, { status: 400 });
  }

  try {
    const day = await getClientHabitDay(auth.clientId, date);
    return NextResponse.json({ success: true, data: day }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Error fetching the habit day:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch habits" }, { status: 500 });
  }
}
