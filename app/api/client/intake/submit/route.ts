import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { submitIntake, IntakeValidationError } from "@/services/client-intake-service";

export async function POST(request: NextRequest) {
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

    const intake = await submitIntake(clientId);

    return NextResponse.json({ success: true, data: intake });
  } catch (error) {
    if (error instanceof IntakeValidationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    console.error("Error submitting intake:", error);
    return NextResponse.json(
      { success: false, error: "Failed to submit intake" },
      { status: 500 }
    );
  }
}
