import { NextRequest, NextResponse } from "next/server";
import {
  validateCheckInToken,
  submitCheckIn,
  markTokenAsUsed,
  getPreviousCheckIn,
} from "@/services/check-in-service";
import { getClientById } from "@/services/client-service";
import { uploadProgressPhotoFromBase64 } from "@/services/storage-service";
import { generateCheckInSummary } from "@/services/ai-service";
import { updateCheckInAISummary, getClientCheckIns } from "@/services/check-in-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { checkInRateLimit } from "@/lib/rate-limit";
import type {
  ValidateCheckInTokenResponse,
  SubmitCheckInRequest,
  SubmitCheckInResponse,
} from "@/types/check-in";

// GET - Validate token and get client info
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // Apply rate limiting
  const rateLimitResult = checkInRateLimit(request);
  if (rateLimitResult) return rateLimitResult;
  try {
    const { token } = await params;

    const validation = await validateCheckInToken(token);

    if (!validation.valid || !validation.clientId) {
      const response: ValidateCheckInTokenResponse = {
        valid: false,
        errorMessage: "Invalid or expired check-in link",
      };
      return NextResponse.json(response, { status: 400 });
    }

    // Fetch actual client info from database
    const client = await getClientById(validation.clientId);

    if (!client) {
      const response: ValidateCheckInTokenResponse = {
        valid: false,
        errorMessage: "Client not found",
      };
      return NextResponse.json(response, { status: 404 });
    }

    // Fetch coach info
    const { data: coach } = await supabaseAdmin
      .from("coaches")
      .select("name")
      .eq("id", client.coachId)
      .single();

    const response: ValidateCheckInTokenResponse = {
      valid: true,
      clientInfo: {
        id: client.id,
        name: client.name,
        email: client.email,
        coachName: (coach as any)?.name || "Your Coach",
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error validating token:", error);
    return NextResponse.json(
      { valid: false, errorMessage: "Server error" },
      { status: 500 }
    );
  }
}

// POST - Submit check-in
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // Apply rate limiting
  const rateLimitResult = checkInRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { token } = await params;
    const body: SubmitCheckInRequest = await request.json();

    // Validate token
    const validation = await validateCheckInToken(token);
    if (!validation.valid || !validation.clientId) {
      const response: SubmitCheckInResponse = {
        success: false,
        errorMessage: "Invalid or expired check-in link",
      };
      return NextResponse.json(response, { status: 400 });
    }

    const clientId = validation.clientId;

    // Handle photo uploads if provided
    let photoUrls = {
      photoFront: body.photoFront,
      photoSide: body.photoSide,
      photoBack: body.photoBack,
    };

    // If photos are base64, upload them to storage
    if (body.photoFront && body.photoFront.startsWith("data:image")) {
      photoUrls.photoFront = await uploadProgressPhotoFromBase64(
        body.photoFront,
        clientId,
        "front"
      );
    }
    if (body.photoSide && body.photoSide.startsWith("data:image")) {
      photoUrls.photoSide = await uploadProgressPhotoFromBase64(
        body.photoSide,
        clientId,
        "side"
      );
    }
    if (body.photoBack && body.photoBack.startsWith("data:image")) {
      photoUrls.photoBack = await uploadProgressPhotoFromBase64(
        body.photoBack,
        clientId,
        "back"
      );
    }

    // Submit check-in
    const checkInId = await submitCheckIn(clientId, {
      ...body,
      ...photoUrls,
    });

    // Mark token as used
    if (validation.tokenId) {
      await markTokenAsUsed(validation.tokenId, checkInId);
    }

    // Get client for AI summary
    const client = await getClientById(clientId);

    // Trigger AI summary generation asynchronously
    triggerAISummaryGeneration(checkInId, clientId, client?.name || "Client").catch((error) => {
      console.error("Error generating AI summary:", error);
    });

    const response: SubmitCheckInResponse = {
      success: true,
      checkInId,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error submitting check-in:", error);
    return NextResponse.json(
      {
        success: false,
        errorMessage: "Failed to submit check-in",
      },
      { status: 500 }
    );
  }
}

// Helper function to trigger AI summary generation
async function triggerAISummaryGeneration(
  checkInId: string,
  clientId: string,
  clientName: string
): Promise<void> {
  try {
    // Get current check-in
    const { checkIns } = await getClientCheckIns(clientId, { limit: 5 });
    const currentCheckIn = checkIns.find((ci) => ci.id === checkInId);

    if (!currentCheckIn) {
      throw new Error("Check-in not found");
    }

    // Get previous check-ins
    const previousCheckIns = checkIns.filter((ci) => ci.id !== checkInId);

    // Generate AI summary
    const aiSummary = await generateCheckInSummary(
      currentCheckIn,
      previousCheckIns,
      clientName
    );

    // Update check-in with AI summary
    await updateCheckInAISummary(
      checkInId,
      aiSummary.summary,
      aiSummary.insights,
      aiSummary.recommendations,
      aiSummary.responseDraft
    );
  } catch (error) {
    console.error("Error in AI summary generation:", error);
    throw error;
  }
}
