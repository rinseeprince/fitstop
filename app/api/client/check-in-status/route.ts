import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientById } from "@/services/client-service";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCheckInStatus, getDateString, getTodayInTimezone } from "@/lib/date-helpers";
import { checkInWeekday } from "@/lib/check-in-week";
import type { CheckInGateStatus } from "@/lib/date-helpers";

/**
 * GET /api/client/check-in-status
 *
 * Lightweight check-in gate status for the home "Weekly check-in" card. Unlike
 * /api/client/check-in-context (which does heavy parallel fetches and 403s when
 * not_due/completed), this always returns 200 with { status, nextDueDate }.
 */
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const client = await getClientById(auth.clientId);
    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 },
      );
    }

    // "No schedule" is the NULL due date, tested at the call site — the gate
    // must stay open for a client with no schedule, and checkInWeekday
    // deliberately never returns null.
    if (!client.nextCheckInDue) {
      return NextResponse.json(
        { success: true, data: { status: "available" as CheckInGateStatus, nextDueDate: null } },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const supabase = await createServerSupabaseClient();
    const { data: lastCheckIn } = await supabase
      .from("check_ins")
      .select("period_end, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastCheckInPeriodEnd =
      lastCheckIn?.period_end ??
      (lastCheckIn?.created_at ? getDateString(new Date(lastCheckIn.created_at)) : null);

    // Client-local today: the gate opens/rolls on the client's day.
    const { status, nextDueDate } = getCheckInStatus(
      checkInWeekday(client),
      lastCheckInPeriodEnd,
      getTodayInTimezone(client.timezone),
      client.startDate,
    );

    return NextResponse.json(
      { success: true, data: { status, nextDueDate } },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error fetching check-in status:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch check-in status" },
      { status: 500 },
    );
  }
}
