import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientTrainingPlan } from "@/services/client-portal-training";

// GET /api/client/training - Get client's active training plan
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const plan = await getClientTrainingPlan(auth.clientId);

    return NextResponse.json({
      success: true,
      data: plan,
    });
  } catch (error) {
    console.error("Error fetching training plan:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch training plan",
      },
      { status: 500 }
    );
  }
}
