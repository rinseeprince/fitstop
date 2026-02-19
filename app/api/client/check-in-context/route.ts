import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import {
  getCheckInTrainingContext,
  getCheckInNutritionContext,
} from "@/services/check-in-context-service";
import { getClientById } from "@/services/client-service";
import { getFrequencyInDays } from "@/services/check-in-tracking-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { clientApiRateLimit } from "@/lib/rate-limit";
import type { ValidateCheckInTokenResponse } from "@/types/check-in";

/**
 * GET /api/client/check-in-context
 * 
 * Retrieves the check-in context for an authenticated client, including
 * client information, training context, and nutrition context needed 
 * for the check-in form.
 * 
 * @param request - The Next.js request object
 * @returns Promise<NextResponse> - JSON response with client context data
 * 
 * @example
 * ```typescript
 * // Response format
 * {
 *   success: true,
 *   data: {
 *     clientInfo: {
 *       id: "client-123",
 *       name: "John Doe",
 *       email: "john@example.com",
 *       coachName: "Jane Coach",
 *       checkInFrequencyDays: 7
 *     },
 *     trainingContext: { ... },
 *     nutritionContext: { ... }
 *   }
 * }
 * ```
 * 
 * @throws {401} Unauthorized - Client not authenticated
 * @throws {404} Client not found
 * @throws {500} Server error during context retrieval
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

    // Fetch client info
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
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

    const response: Omit<ValidateCheckInTokenResponse, "valid"> = {
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

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    console.error("Error fetching check-in context:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch context",
      },
      { status: 500 }
    );
  }
}