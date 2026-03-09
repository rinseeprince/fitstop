import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { activateClientSchema } from "@/lib/validations/client-intake";
import { supabaseAdmin } from "@/services/supabase-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validation = activateClientSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    // Update onboarding_status to active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const updateData: Record<string, unknown> = {
      onboarding_status: "active",
      updated_at: new Date().toISOString(),
    };

    // Store check-in day preference if provided
    if (validation.data.firstCheckInDay) {
      updateData.expected_check_in_day = validation.data.firstCheckInDay;
    }

    const { error } = await db
      .from("clients")
      .update(updateData)
      .eq("id", clientId);

    if (error) throw new Error(`Failed to activate client: ${error.message}`);

    // TODO: Send welcome notification/email to client
    // if (validation.data.welcomeMessage) { ... }

    return NextResponse.json({
      success: true,
      data: { activated: true },
    });
  } catch (error) {
    console.error("Error activating client:", error);
    return NextResponse.json(
      { error: "Failed to activate client" },
      { status: 500 }
    );
  }
}
