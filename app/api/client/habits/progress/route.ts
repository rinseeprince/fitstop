import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientHabitProgress } from "@/services/client-habit-figures-service";
import { habitProgressWeeksSchema } from "@/lib/validations/client-habits";

/**
 * The Journey's habits: for each habit, its figures over the client's last
 * `weeks` weeks (the last holding today) and its last days as they happened,
 * on the client's calendar.
 */
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const weeks = habitProgressWeeksSchema.safeParse(new URL(request.url).searchParams.get("weeks") ?? undefined);
  if (!weeks.success) {
    return NextResponse.json({ success: false, error: "Invalid weeks" }, { status: 400 });
  }

  try {
    const progress = await getClientHabitProgress(auth.clientId, weeks.data);
    return NextResponse.json({ success: true, data: progress }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Error fetching habit progress:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch habit progress" }, { status: 500 });
  }
}
