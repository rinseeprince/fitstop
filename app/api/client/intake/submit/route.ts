import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { submitIntake, IntakeValidationError } from "@/services/client-intake-service";

export async function POST(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const intake = await submitIntake(auth.clientId);

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
