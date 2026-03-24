import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { uploadProgressPhotoFromBase64 } from "@/services/storage-service";
import { submitCheckIn, getClientCheckIns } from "@/services/check-in-service";
import { triggerAISummaryGeneration, updateClientMetricsFromCheckIn } from "@/services/client-check-in-service";
import { updateClientAdherenceStats } from "@/services/check-in-adherence-service";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { clientSubmitCheckInSchema } from "@/lib/validations/check-in";
import { calculateCheckInPeriod } from "@/lib/date-utils";
import { supabaseAdmin } from "@/services/supabase-admin";
import type { SubmitCheckInResponse } from "@/types/check-in";

/**
 * GET /api/client/check-ins
 * 
 * Retrieves the check-in history for an authenticated client with pagination.
 * 
 * @param request - The Next.js request object with optional query params:
 *   - limit: Number of check-ins to return (default: 20)
 *   - offset: Number of check-ins to skip (default: 0)
 * @returns Promise<NextResponse> - JSON response with check-in history and pagination
 * 
 * @example
 * ```typescript
 * // Request: GET /api/client/check-ins?limit=10&offset=0
 * // Response format
 * {
 *   success: true,
 *   data: [
 *     {
 *       id: "checkin-123",
 *       createdAt: "2024-01-01T00:00:00Z",
 *       mood: 4,
 *       energy: 7,
 *       weight: 180,
 *       // ... other check-in fields
 *     }
 *   ],
 *   pagination: {
 *     limit: 10,
 *     offset: 0,
 *     count: 10,
 *     total: 25
 *   }
 * }
 * ```
 * 
 * @throws {401} Unauthorized - Client not authenticated
 * @throws {500} Server error during check-in retrieval
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    const result = await getClientCheckIns(clientId, { limit, offset });

    return NextResponse.json({
      success: true,
      data: result.checkIns,
      pagination: {
        limit,
        offset,
        count: result.checkIns.length,
        total: result.total,
      },
    });
  } catch (error) {
    console.error("Error fetching check-ins:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch check-ins",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/client/check-ins
 * 
 * Submits a comprehensive check-in for an authenticated client. This endpoint
 * processes all check-in data including subjective metrics, body measurements,
 * progress photos, training sessions, and nutrition adherence.
 * 
 * @param request - The Next.js request object with JSON body containing check-in data
 * @returns Promise<NextResponse> - JSON response with submission result
 * 
 * @example
 * ```typescript
 * // Request body format
 * {
 *   mood: 4,
 *   energy: 7,
 *   sleep: 8,
 *   stress: 3,
 *   notes: "Feeling great this week!",
 *   weight: 180,
 *   weightUnit: "lbs",
 *   bodyFatPercentage: 15,
 *   waist: 32,
 *   // ... other measurements and photos
 *   sessionCompletions: [
 *     {
 *       trainingSessionId: "session-123",
 *       sessionName: "Push Day",
 *       completed: true,
 *       completionQuality: "full"
 *     }
 *   ],
 *   exerciseHighlights: [...],
 *   nutritionAdherence: { daysOnTarget: 6 }
 * }
 * 
 * // Response format
 * {
 *   success: true,
 *   checkInId: "checkin-456"
 * }
 * ```
 * 
 * @throws {401} Unauthorized - Client not authenticated
 * @throws {400} Invalid input data
 * @throws {500} Server error during check-in processing
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const authenticatedClientId = await getAuthenticatedClientId();

    if (!authenticatedClientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const rawBody = await request.json();

    // Validate input using the comprehensive schema
    const validationResult = clientSubmitCheckInSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const response: SubmitCheckInResponse = {
        success: false,
        errorMessage: "Invalid input data",
      };
      console.error("Check-in validation failed");
      return NextResponse.json(response, { status: 400 });
    }

    const body = validationResult.data;

    // Client ID is determined from authentication context - no need to verify from request body

    const clientId = authenticatedClientId;

    // Handle photo uploads if provided
    const photoUrls = {
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

    // Submit the comprehensive check-in
    const checkInId = await submitCheckIn(clientId, {
      // Subjective metrics
      mood: body.mood,
      energy: body.energy,
      sleep: body.sleep,
      stress: body.stress,
      notes: body.notes,

      // Body metrics
      weight: body.weight,
      weightUnit: body.weightUnit ?? "lbs",
      bodyFatPercentage: body.bodyFatPercentage,
      waist: body.waist,
      hips: body.hips,
      chest: body.chest,
      arms: body.arms,
      thighs: body.thighs,
      measurementUnit: body.measurementUnit ?? "in",

      // Progress photos
      ...photoUrls,

      // Training metrics
      workoutsCompleted: body.workoutsCompleted,
      adherencePercentage: body.adherencePercentage,
      prs: body.prs,
      challenges: body.challenges,

      // Enhanced tracking
      sessionCompletions: body.sessionCompletions ?? [],
      exerciseHighlights: body.exerciseHighlights ?? [],
      externalActivities: body.externalActivities ?? [],
      nutritionAdherence: body.nutritionAdherence,
    });

    // Store check-in period based on client's expectedCheckInDay
    const client = await getClientById(clientId);
    if (client?.expectedCheckInDay) {
      const { periodStart, periodEnd } = calculateCheckInPeriod(
        new Date(),
        client.expectedCheckInDay
      );
      // TODO: Replace with server client once a scoped UPDATE RLS policy exists for check_ins
      await supabaseAdmin
        .from("check_ins")
        .update({ period_start: periodStart, period_end: periodEnd })
        .eq("id", checkInId);
    }

    // Update client metadata
    if (client) {
      // Update client's current weight, body fat, BMR, and TDEE from check-in data
      await updateClientMetricsFromCheckIn(client, body, checkInId);

      // Update adherence stats
      await updateClientAdherenceStats(clientId);
    }

    // Generate AI summary asynchronously (don't wait for it)
    triggerAISummaryGeneration(checkInId, clientId, client?.name ?? "Client")
      .catch((error) => {
        console.error("Failed to generate AI summary:", error instanceof Error ? error.message : "Unknown error");
      });

    const response: SubmitCheckInResponse = {
      success: true,
      checkInId,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error submitting check-in:", error instanceof Error ? error.message : "Unknown error");

    const response: SubmitCheckInResponse = {
      success: false,
      errorMessage: "Failed to submit check-in",
    };

    return NextResponse.json(response, { status: 500 });
  }
}

