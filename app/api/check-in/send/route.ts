import { NextRequest, NextResponse } from "next/server";
import { createCheckInToken } from "@/services/check-in-service";
import type { CreateCheckInTokenRequest, CreateCheckInTokenResponse } from "@/types/check-in";

export async function POST(request: NextRequest) {
  try {
    const body: CreateCheckInTokenRequest = await request.json();
    const { clientId } = body;

    if (!clientId) {
      return NextResponse.json(
        { error: "Client ID is required" },
        { status: 400 }
      );
    }

    // Create check-in token
    const { token, expiresAt } = await createCheckInToken(clientId);

    // Generate shareable link
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const link = `${appUrl}/check-in/${token}`;

    const response: CreateCheckInTokenResponse = {
      token,
      link,
      expiresAt,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error creating check-in token:", error);
    return NextResponse.json(
      { error: "Failed to create check-in link" },
      { status: 500 }
    );
  }
}
