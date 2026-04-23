import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientForCurrentUser } from "@/services/client-portal-service";

// GET /api/client/me - Get current client's profile
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const client = await getClientForCurrentUser();

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client profile not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: client });
  } catch (error) {
    console.error("Error fetching client profile:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch profile",
      },
      { status: 500 }
    );
  }
}
