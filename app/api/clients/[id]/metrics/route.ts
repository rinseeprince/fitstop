import { NextRequest, NextResponse } from "next/server";
import type { UpdateClientMetricsRequest } from "@/types/check-in";
import { weightToKg } from "@/utils/nutrition-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;

  try {
    // Check authentication
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: UpdateClientMetricsRequest = await request.json();

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

    const client = clientData as any;

    // Validate metric ranges
    if (body.currentWeight !== undefined) {
      const weightKg = weightToKg(body.currentWeight, client.weight_unit || "lbs");
      if (weightKg < 20 || weightKg > 250) {
        return NextResponse.json(
          { error: "Weight must be between 20-250 kg (44-550 lbs)" },
          { status: 400 }
        );
      }
    }

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
        weight_unit: client.weight_unit || "lbs",
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
        const weightKg = weightToKg(client.current_weight, client.weight_unit || "lbs");
        const heightCm = client.height_unit === "in" ? client.height * 2.54 : client.height;
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
    const { error: updateError } = await (supabaseAdmin as any)
      .from("clients")
      .update(updates)
      .eq("id", clientId);

    if (updateError) {
      console.error("Error updating client:", updateError);
      return NextResponse.json(
        { error: "Failed to update metrics" },
        { status: 500 }
      );
    }

    // Get updated client data
    const { data: updatedClient } = await supabaseAdmin
      .from("clients")
      .select("*")
      .eq("id", clientId)
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
