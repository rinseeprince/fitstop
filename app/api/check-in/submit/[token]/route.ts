import { NextRequest, NextResponse } from "next/server";
import {
  validateCheckInToken,
  submitCheckIn,
  markTokenAsUsed,
  getPreviousCheckIn,
} from "@/services/check-in-service";
import { getClientById, updateClient } from "@/services/client-service";
import { uploadProgressPhotoFromBase64 } from "@/services/storage-service";
import { generateCheckInSummary } from "@/services/ai-service";
import { updateCheckInAISummary, getClientCheckIns } from "@/services/check-in-service";
import { markReminderAsResponded } from "@/services/reminder-service";
import { updateClientAdherenceStats } from "@/services/check-in-tracking-service";
import { updateClientBMR } from "@/services/bmr-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { checkInRateLimit } from "@/lib/rate-limit";
import { submitCheckInSchema } from "@/lib/validations/check-in";
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
    const rawBody = await request.json();

    // Validate input using Zod schema
    const validationResult = submitCheckInSchema.safeParse({
      ...rawBody,
      token,
    });

    if (!validationResult.success) {
      const response: SubmitCheckInResponse = {
        success: false,
        errorMessage: "Invalid input data",
      };
      console.error("Validation errors:", validationResult.error.format());
      return NextResponse.json(
        {
          ...response,
          validationErrors: validationResult.error.format(),
        },
        { status: 400 }
      );
    }

    const body = validationResult.data;

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

    // Submit check-in and mark token as used in a coordinated manner
    let checkInId: string;
    try {
      // Step 1: Create the check-in
      checkInId = await submitCheckIn(clientId, {
        ...body,
        ...photoUrls,
      });

      // Step 2: Mark token as used immediately after successful check-in creation
      if (validation.tokenId) {
        await markTokenAsUsed(validation.tokenId, checkInId);
      }
    } catch (error) {
      // If token marking fails after check-in creation, log the issue but don't fail
      // The check-in exists and the token will eventually expire
      if (error instanceof Error && error.message.includes("mark token")) {
        console.error("Check-in created but token marking failed:", error);
        // Continue with the flow - the check-in was successful
      } else {
        // If check-in creation failed, re-throw the error
        throw error;
      }
    }

    // Get client for metrics update and AI summary
    const client = await getClientById(clientId);

    // Critical operations that should be awaited
    try {
      // Update client's current weight and body fat from check-in, then calculate BMR
      if (client) {
        await updateClientMetricsFromCheckIn(client, body);
      }

      // Update client adherence stats
      await updateClientAdherenceStats(clientId);
    } catch (error) {
      console.error("Error in critical post-submission operations:", error);
      // Log but don't fail the submission
    }

    // Non-critical async operations that can run in the background
    // Mark reminder as responded (if there was a reminder sent)
    markReminderAsResponded(clientId, checkInId).catch((error) => {
      console.error("Error marking reminder as responded:", error);
    });

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

// Helper function to update client metrics from check-in and calculate BMR
async function updateClientMetricsFromCheckIn(
  client: any,
  checkInData: SubmitCheckInRequest
): Promise<void> {
  try {
    const updates: any = {};

    // Update current weight if provided in check-in
    if (checkInData.weight !== undefined) {
      updates.currentWeight = checkInData.weight;
    }

    // Update current body fat if provided in check-in
    if (checkInData.bodyFatPercentage !== undefined) {
      updates.currentBodyFatPercentage = checkInData.bodyFatPercentage;
    }

    // Only update if we have new data
    if (Object.keys(updates).length > 0) {
      // Update client with new current metrics
      const updatedClient = await updateClient(client.id, updates);

      // Calculate and update BMR if we have all required data
      const bmr = await updateClientBMR(updatedClient);
      if (bmr !== null) {
        // Calculate TDEE (sedentary = BMR × 1.2)
        const tdee = Math.round(bmr * 1.2);

        // Update BMR and TDEE directly in database
        await supabaseAdmin
          .from("clients")
          .update({ bmr, tdee })
          .eq("id", client.id);
      }
    }
  } catch (error) {
    console.error("Error updating client metrics from check-in:", error);
    throw error;
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
