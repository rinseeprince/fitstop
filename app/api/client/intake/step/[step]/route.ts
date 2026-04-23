import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { saveIntakeStep, IntakeValidationError } from "@/services/client-intake-service";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ step: string }> }
) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { step: stepParam } = await params;
    const step = parseInt(stepParam, 10);

    if (isNaN(step) || step < 1 || step > 5) {
      return NextResponse.json(
        { success: false, error: "Invalid step. Must be 1-5." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const intake = await saveIntakeStep(auth.clientId, step, body);

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
