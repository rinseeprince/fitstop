import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { activatePhase } from "@/services/phase-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId, phaseId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const phase = await activatePhase(phaseId, clientId);

    return NextResponse.json(
      { success: true, data: phase },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to activate phase";
    if (message.includes("Another phase is currently active")) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
    if (message === "Phase not found") {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }
    console.error("Error activating phase:", error);
    return NextResponse.json(
      { error: "Failed to activate phase" },
      { status: 500 }
    );
  }
}
