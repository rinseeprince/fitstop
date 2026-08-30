import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientById } from "@/services/client-service";
import { uploadProgressPhotoFromBase64 } from "@/services/storage-service";
import { submitCheckIn, getClientCheckIns } from "@/services/check-in-service";
import { getCheckInGate } from "@/lib/check-in-schedule";
import { toCanonicalCheckInMetrics } from "@/utils/check-in-canonical-metrics";
import { triggerAISummaryGeneration, updateClientMetricsFromCheckIn } from "@/services/client-check-in-service";
import { updateClientAdherenceStats } from "@/services/check-in-adherence-service";
import { submitCheckInSchema } from "@/lib/validations/check-in";
import { applyCheckInForm } from "@/lib/check-in/form-fields";
import { getClientCheckInForm } from "@/services/check-in-form-service";
import { decodeCursor, encodeCursor } from "@/lib/cursor";
import { supabaseAdmin } from "@/services/supabase-admin";
import { toClientFacingCheckIn } from "@/lib/mappers";
import { generateAndSaveCheckInSnapshot } from "@/services/check-in-snapshot-service";
import { captureApiError } from "@/lib/error-handler";
import type { SubmitCheckInResponse } from "@/types/check-in";

/**
 * GET /api/client/check-ins
 * 
 * Retrieves the check-in history for an authenticated client with pagination.
 * 
 * Keyset is the default mode (the native contract): the whole list pages on a
 * stable (created_at, id) cursor.
 *   - First page:  `?limit=10`               → `{ ..., nextCursor, hasMore }`
 *   - Next pages:  `?limit=10&cursor=<opaque>`→ `{ ..., nextCursor, hasMore }`
 *   - Legacy offset (explicit opt-in only): `?offset=N` → `{ ..., offset, total }`
 *
 * @param request - The Next.js request object with optional query params:
 *   - limit: Number of check-ins to return (default: 20, max 100)
 *   - cursor: Opaque keyset cursor for the next page
 *   - offset: Legacy offset mode (only honored when explicitly present)
 * @returns Promise<NextResponse> - JSON response with check-in history and pagination
 *
 * @throws {400} Invalid cursor
 * @throws {401} Unauthorized - Client not authenticated
 * @throws {500} Server error during check-in retrieval
 */
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const offsetParam = searchParams.get("offset");

    // Legacy offset mode — only when explicitly requested.
    if (offsetParam !== null) {
      const offset = Math.max(parseInt(offsetParam, 10) || 0, 0);
      const result = await getClientCheckIns(auth.clientId, { limit, offset });

      return NextResponse.json({
        success: true,
        data: result.checkIns.map(toClientFacingCheckIn),
        pagination: {
          limit,
          offset,
          count: result.checkIns.length,
          total: result.total,
        },
      });
    }

    // Keyset mode (default). cursor is absent on the first page, present thereafter.
    const cursorParam = searchParams.get("cursor");
    let cursor;
    if (cursorParam !== null) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) {
        return NextResponse.json(
          { success: false, error: "Invalid cursor" },
          { status: 400 }
        );
      }
    }

    const result = await getClientCheckIns(auth.clientId, { limit, keyset: true, cursor });

    return NextResponse.json({
      success: true,
      data: result.checkIns.map(toClientFacingCheckIn),
      pagination: {
        limit,
        count: result.checkIns.length,
        nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
        hasMore: result.nextCursor !== null,
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
 * @throws {409} Not due yet, or already checked in for this period
 * @throws {500} Server error during check-in processing
 */
export async function POST(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;
  const authenticatedClientId = auth.clientId;

  try {
    const rawBody = await request.json();

    // Validate input using the comprehensive schema
    const validationResult = submitCheckInSchema.safeParse(rawBody);

    if (!validationResult.success) {
      // Log the issues and return the first one: a bare "Invalid input data"
      // left a 400 undiagnosable from either side (the client toast read
      // "Failed to submit check-in" and the server log said only "failed").
      const issues = validationResult.error.issues;
      console.error("Check-in validation failed:", validationResult.error.flatten());
      const first = issues[0];
      const where = first?.path.length ? `${first.path.join(".")}: ` : "";
      const response: SubmitCheckInResponse = {
        success: false,
        errorMessage: first ? `${where}${first.message}` : "Invalid input data",
      };
      return NextResponse.json(response, { status: 400 });
    }

    const body = validationResult.data;

    // Client ID is determined from authentication context - no need to verify from request body

    const clientId = authenticatedClientId;

    // The gate again, on the WRITE path.
    //
    // Until now "you cannot check in early, or twice" was enforced only by the
    // screen that opens the form (GET /api/client/check-in-context). That is
    // fine against a person and useless against a double-tap or a background
    // retry, which is the realistic way two check-ins land for one week — and
    // two check-ins advance the schedule twice, so the client silently SKIPS
    // one. The comment further down records this exact class of bug happening
    // once already, at a midnight boundary.
    //
    // 409, not 403: the request is authenticated and authorised, it just
    // conflicts with the state the client is already in — the same reading as
    // the training-event occupancy conflicts.
    //
    // Before the photo uploads deliberately: refusing after them would burn the
    // work and leave orphaned objects in storage.
    const client = await getClientById(clientId);
    if (client) {
      const { status, nextDueDate } = getCheckInGate(client);
      if (status === "unscheduled") {
        const response: SubmitCheckInResponse = {
          success: false,
          errorMessage: "Your coach has not scheduled your check-ins yet.",
        };
        return NextResponse.json(response, { status: 409 });
      }
      if (status === "not_due") {
        const response: SubmitCheckInResponse = {
          success: false,
          errorMessage: nextDueDate
            ? `Your next check-in is due on ${nextDueDate}.`
            : "You are not due for a check-in yet.",
        };
        return NextResponse.json(response, { status: 409 });
      }
    }

    // Shape the submission to the form the coach actually asks (#4).
    //
    // BEFORE the photo uploads, deliberately: a disabled photo must never be
    // uploaded and then discarded, which would burn the work and leave an
    // orphaned storage object — the same reasoning that puts the gate above
    // them. STRIP, never 400 (D4.3): a payload carrying a disabled field is a
    // client who loaded the form, or restored a draft, before the coach
    // changed it, and rejecting punishes them for someone else's edit.
    //
    // Resolved unconditionally rather than inside the `if (client)` above:
    // this needs only the authenticated `clientId`, and `getAuthenticatedClientId`
    // already filters on `clients.active`, so the null-client branch is
    // unreachable in practice. A form that failed to resolve THROWS rather
    // than defaulting to "ask everything" — the read must never impersonate
    // "no form" on the write path.
    const form = await getClientCheckInForm(clientId);
    const shaped = applyCheckInForm(body, {
      fields: form.fields,
      questionIds: form.questions.map((q) => q.id),
    });

    // Handle photo uploads if provided
    const photoUrls = {
      photoFront: shaped.photoFront,
      photoSide: shaped.photoSide,
      photoBack: shaped.photoBack,
    };

    // If photos are base64, upload them to storage
    if (shaped.photoFront && shaped.photoFront.startsWith("data:image")) {
      photoUrls.photoFront = await uploadProgressPhotoFromBase64(
        shaped.photoFront,
        clientId,
        "front"
      );
    }
    if (shaped.photoSide && shaped.photoSide.startsWith("data:image")) {
      photoUrls.photoSide = await uploadProgressPhotoFromBase64(
        shaped.photoSide,
        clientId,
        "side"
      );
    }
    if (shaped.photoBack && shaped.photoBack.startsWith("data:image")) {
      photoUrls.photoBack = await uploadProgressPhotoFromBase64(
        shaped.photoBack,
        clientId,
        "back"
      );
    }

    // Display units in, canonical kg/cm out — see toCanonicalCheckInMetrics.
    // Both this call and updateClientMetricsFromCheckIn below take the result.
    const canonical = toCanonicalCheckInMetrics(shaped);

    // Submit the comprehensive check-in
    const checkInId = await submitCheckIn(clientId, {
      // Subjective metrics
      mood: shaped.mood,
      energy: shaped.energy,
      sleep: shaped.sleep,
      stress: shaped.stress,
      notes: shaped.notes,

      // Body metrics — canonical kg/cm.
      weight: canonical.weight,
      bodyFatPercentage: shaped.bodyFatPercentage,
      waist: canonical.waist,
      hips: canonical.hips,
      chest: canonical.chest,
      arms: canonical.arms,
      thighs: canonical.thighs,

      // Progress photos
      ...photoUrls,

      // Training metrics
      workoutsCompleted: shaped.workoutsCompleted,
      adherencePercentage: shaped.adherencePercentage,
      prs: shaped.prs,
      challenges: shaped.challenges,

      // Enhanced tracking
      sessionCompletions: shaped.sessionCompletions ?? [],
      exerciseHighlights: canonical.exerciseHighlights ?? [],
      nutritionAdherence: shaped.nutritionAdherence,

      // Answers to the coach's custom questions, already filtered to the
      // enabled question set with blanks and duplicates removed.
      customAnswers: shaped.customAnswers,
    });

    // Freeze the period snapshot over the period submitCheckIn STORED
    // (client-local, activation-clamped). Do not recompute the window here:
    // an earlier version re-derived it from the server clock with
    // calculateCheckInPeriod and UPDATE'd the row, silently overwriting the
    // client-local period — which broke the "completed" gate right after
    // submitting (duplicate same-week check-ins at the midnight boundary) and
    // froze the snapshot over the wrong week.
    const { data: storedPeriod } = await supabaseAdmin
      .from("check_ins")
      .select("period_start, period_end")
      .eq("id", checkInId)
      .single();
    if (storedPeriod?.period_start && storedPeriod.period_end) {
      // Awaited so AI can use it
      await generateAndSaveCheckInSnapshot(checkInId, clientId, storedPeriod.period_start, storedPeriod.period_end)
        .catch((err) => captureApiError(err, { action: "check-in-snapshot-generation", checkInId, clientId }));
    }

    // Update client metadata
    if (client) {
      // Update client's current weight, body fat, BMR, and TDEE from check-in data
      await updateClientMetricsFromCheckIn(client, canonical, checkInId);

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

