import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { updateClientMetricsSchema } from "@/lib/validations/client-metrics";
import { recordBodyMetrics } from "@/services/body-metrics-service";
import { updateGoals } from "@/services/client-goals-service";

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

    const client = clientData;

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

    if (body.bmr !== undefined) {
      if (body.bmr < 800 || body.bmr > 5000) {
        return NextResponse.json(
          { error: "BMR must be between 800-5000 cal/day" },
          { status: 400 }
        );
      }
    }

    if (body.tdee !== undefined) {
      if (body.tdee < 1000 || body.tdee > 8000) {
        return NextResponse.json(
          { error: "TDEE must be between 1000-8000 cal/day" },
          { status: 400 }
        );
      }
    }

    // If saving as check-in, create check-in record
    if (
      body.saveOption === "check-in" &&
      (body.currentWeight !== undefined || body.currentBodyFatPercentage !== undefined)
    ) {
      const checkInData: any = {
        client_id: clientId,
        submitted_at: new Date().toISOString(),
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
    const updates: any = {};

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

    if (body.bmr !== undefined) {
      updates.bmr = body.bmr;
      updates.bmr_manual_override = body.bmrManualOverride ?? true;
    }

    if (body.tdee !== undefined) {
      updates.tdee = body.tdee;
      updates.tdee_manual_override = body.tdeeManualOverride ?? true;
    }

    // Reset manual overrides if requested
    if (body.bmrManualOverride === false) {
      updates.bmr_manual_override = false;
      // Recalculate BMR based on current data
      if (client.current_weight && client.height && client.gender && client.date_of_birth) {
        // Stored canonically since migration 141 — read straight through.
        const weightKg = client.current_weight;
        const heightCm = client.height;
        const age = new Date().getFullYear() - new Date(client.date_of_birth).getFullYear();

        let bmr;
        if (client.gender === "male") {
          bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
        } else if (client.gender === "female") {
          bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
        } else {
          bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 78;
        }

        updates.bmr = Math.round(bmr);
      }
    }

    if (body.tdeeManualOverride === false) {
      updates.tdee_manual_override = false;
      // Recalculate TDEE as BMR * 1.2 (sedentary)
      const bmrValue = updates.bmr || client.bmr;
      if (bmrValue) {
        updates.tdee = Math.round(bmrValue * 1.2);
      }
    }

    // Update client record
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

    // Dual-write body metrics (non-blocking)
    if (body.currentWeight !== undefined || body.currentBodyFatPercentage !== undefined ||
        body.bmr !== undefined || body.tdee !== undefined) {
      try {
        await recordBodyMetrics({
          clientId,
          weight: body.currentWeight,
          bodyFatPercentage: body.currentBodyFatPercentage,
          bmr: updates.bmr ?? undefined,
          tdee: updates.tdee ?? undefined,
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
