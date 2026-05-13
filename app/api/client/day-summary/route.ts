import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getDateString } from "@/lib/date-helpers";
import { getDaySummary } from "@/services/client-day-service";

const DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  // Day-summary supports a swipeable timeline (past + today + future). Validate
  // the date is a real YYYY-MM-DD without imposing past/future bounds — those
  // belong to write-side enforcement via canEditDay (Session 3.x), not the read
  // path. Mirrors the client-side parser in app/client/page.tsx.
  if (!DATE_SHAPE_RE.test(date)) {
    return NextResponse.json(
      { success: false, error: "Invalid date format. Use YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const parsed = new Date(date + "T00:00:00");
  if (Number.isNaN(parsed.getTime()) || getDateString(parsed) !== date) {
    return NextResponse.json(
      { success: false, error: "Invalid date" },
      { status: 400 }
    );
  }

  try {
    const data = await getDaySummary(auth.clientId, date);
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching day summary:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch day summary" },
      { status: 500 }
    );
  }
}
