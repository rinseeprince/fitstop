import { NextRequest, NextResponse } from "next/server";
import {
  validateCheckInToken,
  submitCheckIn,
  claimTokenForProcessing,
  updateTokenWithCheckInId,
  releaseToken,
  getPreviousCheckIn,
  getCheckInWithDetails,
} from "@/services/check-in-service";
import { getClientById, updateClient } from "@/services/client-service";
import { uploadProgressPhotoFromBase64 } from "@/services/storage-service";
import { generateCheckInSummary } from "@/services/ai-service";
import { updateCheckInAISummary, getClientCheckIns } from "@/services/check-in-service";
import { markReminderAsResponded } from "@/services/reminder-service";
import {
  updateClientAdherenceStats,
  getFrequencyInDays,
} from "@/services/check-in-tracking-service";
import { updateClientBMR } from "@/services/bmr-service";
import {
  getCheckInTrainingContext,
  getCheckInNutritionContext,
} from "@/services/check-in-context-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { updateClientMetricsFromCheckIn, triggerAISummaryGeneration } from "@/services/client-check-in-service";
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

    // Fetch coach info and context in parallel
    const [coachResult, trainingContext, nutritionContext] = await Promise.all([
      supabaseAdmin
        .from("coaches")
        .select("name")
        .eq("id", client.coachId)
        .single(),
      getCheckInTrainingContext(client.id),
      getCheckInNutritionContext(client.id),
    ]);

    const coach = coachResult.data;

    const response: ValidateCheckInTokenResponse = {
      valid: true,
      clientInfo: {
        id: client.id,
        name: client.name,
        email: client.email,
        coachName: coach?.name || "Your Coach",
        checkInFrequencyDays: getFrequencyInDays(
          client.checkInFrequency || "weekly",
          client.checkInFrequencyDays
        ),
      },
      trainingContext,
      nutritionContext,
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

    // Atomically claim token FIRST to prevent race conditions
    // This ensures only one request can process this token
    let checkInId: string | undefined;
    let tokenClaimed = false;

    if (validation.tokenId) {
      tokenClaimed = await claimTokenForProcessing(validation.tokenId);
      if (!tokenClaimed) {
        // Token was already claimed by another request (race condition prevented)
        return NextResponse.json(
          {
            success: false,
            errorMessage: "This check-in link has already been used",
          },
          { status: 409 }
        );
      }
    }

    try {
      // Create the check-in (token is already claimed, safe from duplicates)
      checkInId = await submitCheckIn(clientId, {
        ...body,
        ...photoUrls,
      });

      // Update token with the check-in ID
      if (validation.tokenId && checkInId) {
        await updateTokenWithCheckInId(validation.tokenId, checkInId);
      }
    } catch (error) {
      // If check-in creation failed, release the token so user can retry
      if (validation.tokenId && tokenClaimed) {
        await releaseToken(validation.tokenId);
      }
      throw error;
    }

    // Ensure checkInId was created
    if (!checkInId) {
      return NextResponse.json(
        { success: false, errorMessage: "Failed to create check-in" },
        { status: 500 }
      );
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
