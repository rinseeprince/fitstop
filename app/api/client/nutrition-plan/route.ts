import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientNutritionTargets } from "@/services/client-portal-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await getClientNutritionTargets(auth.clientId);
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching client nutrition plan:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch nutrition plan" },
      { status: 500 }
    );
  }
}
