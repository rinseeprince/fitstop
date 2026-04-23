import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientHabits } from "@/services/daily-habits-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const habits = await getClientHabits(auth.clientId);

    return NextResponse.json({
      success: true,
      data: habits,
    });
  } catch (error) {
    console.error("Error fetching client habits:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch habits",
      },
      { status: 500 }
    );
  }
}