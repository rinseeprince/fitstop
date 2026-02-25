import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import {
  getCheckInTrainingContext,
  getCheckInNutritionContext,
} from "@/services/check-in-context-service";
import { getClientById } from "@/services/client-service";
import { getFrequencyInDays } from "@/services/check-in-tracking-service";
import { getPreviousCheckIn } from "@/services/check-in-service";
import { getDailyLogs } from "@/services/daily-logs-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getDateDaysAgo, getTodayDateString } from "@/lib/date-helpers";
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

    // Fetch coach info, context, and check-in data in parallel
    const [coachResult, trainingContext, nutritionContext, lastCheckIn] = await Promise.all([
      supabaseAdmin
        .from("coaches")
        .select("name")
        .eq("id", client.coachId)
        .single(),
      getCheckInTrainingContext(client.id),
      getCheckInNutritionContext(client.id),
      // Get the most recent check-in to determine the period
      supabaseAdmin
        .from("check_ins")
        .select("created_at")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const coach = coachResult.data;

    // Determine the check-in period
    let startDate: string;
    let lastCheckInDate: string | undefined;
    
    if (lastCheckIn.data && lastCheckIn.data.created_at) {
      // Use the date of the last check-in as the start date
      const lastCheckInDateObj = new Date(lastCheckIn.data.created_at);
      lastCheckInDateObj.setDate(lastCheckInDateObj.getDate() + 1); // Start from the day after last check-in
      startDate = lastCheckInDateObj.toISOString().split('T')[0];
      lastCheckInDate = new Date(lastCheckIn.data.created_at).toISOString().split('T')[0];
    } else {
      // No previous check-in, use last 7 days
      startDate = getDateDaysAgo(7);
    }
    
    const endDate = getTodayDateString();

    // Fetch daily logs for the period
    const dailyLogs = await getDailyLogs(client.id, startDate, endDate);

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
        lastCheckInDate,
      },
      trainingContext,
      nutritionContext,
      dailyLogs,
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