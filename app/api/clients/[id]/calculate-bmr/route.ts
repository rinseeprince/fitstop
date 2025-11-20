import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { updateClientBMR } from "@/services/bmr-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Apply rate limiting
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

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

    // Check if we have all required data
    if (!client.currentWeight || !client.height || !client.gender) {
      return NextResponse.json(
        {
          error: "Missing required data for BMR calculation. Need: current weight, height, and gender.",
          missing: {
            currentWeight: !client.currentWeight,
            height: !client.height,
            gender: !client.gender
          }
        },
        { status: 400 }
      );
    }

    // Calculate BMR
    const bmr = await updateClientBMR(client);

    if (bmr === null) {
      return NextResponse.json(
        { error: "Failed to calculate BMR" },
        { status: 500 }
      );
    }

    // Calculate TDEE (sedentary = BMR × 1.2)
    const tdee = Math.round(bmr * 1.2);

    // Update BMR in database
    await supabaseAdmin
      .from("clients")
      .update(
        // @ts-expect-error - Database type inference issue
        { bmr, tdee }
      )
      .eq("id", id);

    return NextResponse.json(
      {
        success: true,
        bmr,
        tdee
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
