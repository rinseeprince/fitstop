import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { saveIntakeStep, IntakeValidationError } from "@/services/client-intake-service";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ step: string }> }
) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const clientId = await getAuthenticatedClientId();
    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { step: stepParam } = await params;
    const step = parseInt(stepParam, 10);

    if (isNaN(step) || step < 1 || step > 5) {
      return NextResponse.json(
        { success: false, error: "Invalid step. Must be 1-5." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const intake = await saveIntakeStep(clientId, step, body);

    return NextResponse.json({ success: true, data: intake });
  } catch (error) {
    if (error instanceof IntakeValidationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    console.error("Error saving intake step:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save step" },
      { status: 500 }
    );
  }
}
