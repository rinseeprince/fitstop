import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { recalculateClientEnergy } from "@/services/client-energy-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Apply rate limiting
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    // Check authentication
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Get client
    const client = await getClientById(id);

    if (!client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    // Verify the client belongs to the authenticated coach
    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    // Recompute through the single owner of the pair. This route used to write
    // `{ bmr }` alone — a BMR recalc left TDEE stranded at a value derived from
    // a BMR that no longer existed, which is exactly how a profile came to read
    // BMR 3712 beside TDEE 3515. It does NOT clear override flags: silently
    // discarding a coach's custom value on a button press would be worse than
    // the bug it fixes.
    const energy = await recalculateClientEnergy(id, { coachId });

    if (energy.status === "skipped_insufficient_data") {
      return NextResponse.json(
        {
          error: "Missing required data for BMR calculation. Need: current weight, height, and gender.",
          missing: energy.missing,
        },
        { status: 400 }
      );
    }

    if (energy.status === "failed" || energy.status === "skipped_client_not_found") {
      return NextResponse.json(
        { error: "Failed to calculate BMR" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        bmr: energy.bmr,
        tdee: energy.tdee,
        message: "BMR and TDEE recalculated from the client's current metrics.",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error calculating BMR:", error);
    return NextResponse.json(
      { error: "Failed to calculate BMR" },
      { status: 500 }
    );
  }
}
