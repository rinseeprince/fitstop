import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientNutritionTargets } from "@/services/client-portal-service";

// GET /api/client/nutrition - Get client's nutrition targets
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const targets = await getClientNutritionTargets(auth.clientId);

    return NextResponse.json({
      success: true,
      data: targets,
    });
  } catch (error) {
    console.error("Error fetching nutrition targets:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch nutrition",
      },
      { status: 500 }
    );
  }
}
