import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { updateClientMetricsSchema } from "@/lib/validations/client-metrics";
import { appendMeasurements } from "@/services/measurements-service";
import { updateGoals } from "@/services/client-goals-service";
import { recalculateClientEnergy } from "@/services/client-energy-service";
import type { ClientEnergyOverrides } from "@/services/client-energy-service";
import { getCoachTodayString } from "@/services/today-service";

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

    // A reading on this wire is the coach's entry, dated the coach's today —
    // a row in the measurement log, never a column. The append recomputes the
    // energy pair itself when the row is the client's newest.
    if (body.currentWeight !== undefined || body.currentBodyFatPercentage !== undefined) {
      await appendMeasurements({
        clientId,
        source: "coach_entry",
        recordedOn: await getCoachTodayString(coachId),
        values: { weight: body.currentWeight, bodyFat: body.currentBodyFatPercentage },
        createdBy: coachId,
      });
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

    // Runs after the readings above landed, so an override in the same request
    // is applied over the pair they produced and the coach's typed number wins.
    const energy = hasOverrides
      ? await recalculateClientEnergy(clientId, { coachId, overrides })
      : null;

    // An impossible override is a 400, not a silent no-op: the coach typed a
    // number and must be told it was not stored.
    if (energy?.status === "rejected_invalid_override") {
      return NextResponse.json(
        { error: energy.rejection ?? "Invalid energy override" },
        { status: 400 }
      );
    }

    // Goals are written ONCE, by `updateGoals`, which owns both stores. **This
    // throws**: a swallowed goal failure returned 200 while the mirror moved and
    // `client_goals` did not, and nothing surfaced it. The measurement writes
    // above are already committed and are unaffected.
    if (body.goalWeight !== undefined || body.goalBodyFatPercentage !== undefined) {
      await updateGoals(clientId, {
        goalWeight: body.goalWeight,
        goalBodyFatPercentage: body.goalBodyFatPercentage,
      }, coachId);
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
