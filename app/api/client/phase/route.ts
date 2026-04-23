import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getActivePhase } from "@/services/phase-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const phase = await getActivePhase(auth.clientId);

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
