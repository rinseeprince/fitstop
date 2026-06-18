import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getActivePhase, promotePhaseIfReady } from "@/services/phase-service";
import { captureApiError } from "@/lib/error-handler";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // Date-driven auto-activation on the client's own read, so a due phase flips
    // active when the client's day rolls over (not only when a coach looks).
    await promotePhaseIfReady(auth.clientId).catch((err) =>
      captureApiError(err, {
        action: "promote-phase-client-read",
        clientId: auth.clientId,
      }),
    );

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
