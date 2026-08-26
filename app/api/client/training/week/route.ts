import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getDateString } from "@/lib/date-helpers";
import { getClientTrainingWeek } from "@/services/client-training-week-service";

const DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET — the client's training week containing `date` (`ClientTrainingWeek`,
 * `types/client-training-week.ts`): every session in the check-in-anchored
 * week with a `state` derived against the client's own today. Powers the
 * session picker and the week view; it is also exactly the set a layout write
 * may touch. ≤7 rows, `no-store`, same date validation as day-summary.
 */
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date) {
    return NextResponse.json(
      { success: false, error: "Missing required date parameter" },
      { status: 400 }
    );
  }
  if (!DATE_SHAPE_RE.test(date)) {
    return NextResponse.json(
      { success: false, error: "Invalid date format. Use YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const parsed = new Date(date + "T00:00:00");
  if (Number.isNaN(parsed.getTime()) || getDateString(parsed) !== date) {
    return NextResponse.json({ success: false, error: "Invalid date" }, { status: 400 });
  }

  try {
    const data = await getClientTrainingWeek(auth.clientId, date);
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error loading training week:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load training week" },
      { status: 500 }
    );
  }
}
