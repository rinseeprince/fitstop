import { NextRequest, NextResponse } from "next/server";
import { createCheckInToken } from "@/services/check-in-service";
import type { CreateCheckInTokenResponse } from "@/types/check-in";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { sendCheckInSchema } from "@/lib/validations/check-in";

export async function POST(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const body = await request.json();
    const parsed = sendCheckInSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Send check-in validation error:", parsed.error.flatten());
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }
    const { clientId } = parsed.data;

    // Verify coach owns this client
    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

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
