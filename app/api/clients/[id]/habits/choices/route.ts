import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { listHabitChoices } from "@/services/client-habits-service";
import { getClientTodayString } from "@/services/today-service";

type Params = { params: Promise<{ id: string }> };

/**
 * The habits this coach has given any of their clients — one per name and way
 * of measuring, with its newest version's how-to, target and days — less the
 * ones this client has running or planned from their today.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const choices = await listHabitChoices(auth.coachId, clientId, await getClientTodayString(clientId));
    return NextResponse.json(
      { success: true, data: choices },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching habit choices:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch habit choices" }, { status: 500 });
  }
}
