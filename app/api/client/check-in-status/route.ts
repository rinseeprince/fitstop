import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientById } from "@/services/client-service";
import { getCheckInGate } from "@/lib/check-in-schedule";

/**
 * GET /api/client/check-in-status
 *
 * Lightweight check-in gate status for the home "Weekly check-in" card. Unlike
 * /api/client/check-in-context (which does heavy parallel fetches and 403s when
 * not_due), this always returns 200 with { status, nextDueDate }.
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

    // A pure read of the stored due date — the client's check-in history is no
    // longer part of the answer, so the query that used to fetch it is gone.
    const { status, nextDueDate } = getCheckInGate(client);

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
