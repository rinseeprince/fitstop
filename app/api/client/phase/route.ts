import { NextRequest, NextResponse } from "next/server";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getActivePhase } from "@/services/phase-service";

export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const phase = await getActivePhase(clientId);

    return NextResponse.json(
      { success: true, data: phase },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching active phase:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch active phase" },
      { status: 500 }
    );
  }
}
