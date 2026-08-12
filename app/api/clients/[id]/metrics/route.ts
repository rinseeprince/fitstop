import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { updateClientMetricsSchema } from "@/lib/validations/client-metrics";
import { recordBodyMetrics } from "@/services/body-metrics-service";
import { updateGoals } from "@/services/client-goals-service";
import { recalculateClientEnergy } from "@/services/client-energy-service";
import type { ClientEnergyOverrides } from "@/services/client-energy-service";
import type { CheckInInsert, ClientUpdate } from "@/lib/database-helpers";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  const { id: clientId } = await params;

  try {
    // Check authentication
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await request.json();
    const parseResult = updateClientMetricsSchema.safeParse(rawBody);
    if (!parseResult.success) {
      console.error("Validation error:", parseResult.error.format());
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }
    const body = parseResult.data;

    // Get current client data
    const { data: clientData, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .eq("coach_id", coachId)
      .single();

    if (clientError || !clientData) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    // The `client` alias that used to sit here fed the inline Mifflin-St Jeor
    // block; the read above now exists only for the ownership 404.

    // Validate the ranges the schema does not already cover. The weight bound
    // that used to sit here was a second, tighter copy of the schema's — the
    // schema said 20-700 (pounds-shaped) and this said 20-250 kg. Both now read
    // WEIGHT_KG_MIN/MAX from lib/constants, so updateClientMetricsSchema
    // rejects an out-of-range weight before this handler runs.
    if (body.currentBodyFatPercentage !== undefined) {
      if (body.currentBodyFatPercentage < 3 || body.currentBodyFatPercentage > 60) {
        return NextResponse.json(
          { error: "Body fat percentage must be between 3-60%" },
          { status: 400 }
        );
      }
    }

    // The bmr/tdee bounds that used to sit here were exact duplicates of the
    // schema's, so updateClientMetricsSchema has already rejected an
    // out-of-range value before this handler runs.

    // If saving as check-in, create check-in record
    if (
      body.saveOption === "check-in" &&
      (body.currentWeight !== undefined || body.currentBodyFatPercentage !== undefined)
    ) {
      // `submitted_at` was written here until typing this object surfaced that
      // check_ins has no such column — the insert would have been rejected by
      // PostgREST. `created_at` carries the submission time by default.
      const checkInData: CheckInInsert = {
        client_id: clientId,
        weight: body.currentWeight,
        body_fat_percentage: body.currentBodyFatPercentage,
      };

      const { error: checkInError } = await supabaseAdmin
        .from("check_ins")
        .insert(checkInData);

      if (checkInError) {
        console.error("Error creating check-in:", checkInError);
        return NextResponse.json(
          { error: "Failed to create check-in" },
          { status: 500 }
        );
      }
    }

    // Build update object
    const updates: ClientUpdate = {};

    if (body.currentWeight !== undefined) {
      updates.current_weight = body.currentWeight;
    }

    if (body.currentBodyFatPercentage !== undefined) {
      updates.current_body_fat_percentage = body.currentBodyFatPercentage;
    }

    if (body.goalWeight !== undefined) {
      updates.goal_weight = body.goalWeight;
    }

    if (body.goalBodyFatPercentage !== undefined) {
      updates.goal_body_fat_percentage = body.goalBodyFatPercentage;
    }

    // bmr/tdee are NOT written from here. This handler used to set them
    // directly, re-implement Mifflin-St Jeor inline for "reset to auto", and
    // hardcode `tdee = bmr * 1.2` twice — which is how a client's TDEE came to
    // contradict their own BMR. Both halves now go through the one owner
    // below, as override instructions.
    const overrides: ClientEnergyOverrides = {};
    if (body.bmr !== undefined) {
      overrides.bmr = { action: "set", value: body.bmr };
    } else if (body.bmrManualOverride === false) {
      overrides.bmr = { action: "clear" };
    }
    if (body.tdee !== undefined) {
      overrides.tdee = { action: "set", value: body.tdee };
    } else if (body.tdeeManualOverride === false) {
      overrides.tdee = { action: "clear" };
    }
    const hasOverrides = overrides.bmr !== undefined || overrides.tdee !== undefined;

    // An override-only body leaves `updates` empty, and an empty .update({})
    // is a wasted round trip at best.
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("clients")
        .update(updates)
        .eq("id", clientId)
        .eq("coach_id", coachId);

      if (updateError) {
        console.error("Error updating client:", updateError);
        return NextResponse.json(
          { error: "Failed to update metrics" },
          { status: 500 }
        );
      }
    }

    // Recompute the pair. Runs after the measurements above commit, so it reads
    // the new weight/body fat rather than the pre-write row.
    const energyInputChanged =
      body.currentWeight !== undefined || body.currentBodyFatPercentage !== undefined;
    const energy =
      energyInputChanged || hasOverrides
        ? await recalculateClientEnergy(clientId, {
            coachId,
            overrides: hasOverrides ? overrides : undefined,
          })
        : null;

    // Dual-write body metrics (non-blocking). The pair comes from the helper's
    // result, never recomputed here, so the event matches the profile.
    if (body.currentWeight !== undefined || body.currentBodyFatPercentage !== undefined ||
        energy?.status === "written") {
      try {
        await recordBodyMetrics({
          clientId,
          weight: body.currentWeight,
          bodyFatPercentage: body.currentBodyFatPercentage,
          bmr: energy?.bmr ?? undefined,
          tdee: energy?.tdee ?? undefined,
          source: "metrics_api",
        });
      } catch (dualWriteError) {
        console.error("Dual-write to body_metrics failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
      }
    }

    // Dual-write goals (non-blocking)
    if (body.goalWeight !== undefined || body.goalBodyFatPercentage !== undefined) {
      try {
        await updateGoals(clientId, {
          goalWeight: body.goalWeight,
          goalBodyFatPercentage: body.goalBodyFatPercentage,
        }, coachId);
      } catch (dualWriteError) {
        console.error("Dual-write to client_goals failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
      }
    }

    // Get updated client data
    const { data: updatedClient } = await supabaseAdmin
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .eq("coach_id", coachId)
      .single();

    return NextResponse.json({
      success: true,
      client: updatedClient,
    });
  } catch (error) {
    console.error("Error updating metrics:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
