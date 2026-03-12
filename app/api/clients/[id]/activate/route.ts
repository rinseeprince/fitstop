import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { activateClientSchema } from "@/lib/validations/client-intake";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { sendActivationEmail } from "@/services/email-service";
import type { OnboardingStatus } from "@/types/client-intake";
import type { DayOfWeek } from "@/types/check-in";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId, true);
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validation = activateClientSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    // Update onboarding_status to active
    const supabase = await createServerSupabaseClient();
    const updateData: {
      onboarding_status: OnboardingStatus;
      updated_at: string;
      expected_check_in_day?: DayOfWeek;
      welcome_message?: string;
      start_date?: string;
    } = {
      onboarding_status: "active",
      updated_at: new Date().toISOString(),
    };

    if (validation.data.firstCheckInDay) {
      updateData.expected_check_in_day = validation.data.firstCheckInDay;
    }

    if (validation.data.welcomeMessage) {
      updateData.welcome_message = validation.data.welcomeMessage;
    }

    if (validation.data.startDate) {
      updateData.start_date = validation.data.startDate;
    }

    const { error } = await supabase
      .from("clients")
      .update(updateData)
      .eq("id", clientId);

    if (error) {
      console.error("Supabase update error:", error.message);
      throw new Error("Failed to activate client");
    }

    // Send activation email (fire-and-forget)
    fireAndForgetActivationEmail(supabase, clientId, client.email, client.name);

    return NextResponse.json({
      success: true,
      data: { activated: true },
    });
  } catch (error) {
    console.error("Error activating client:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to activate client" },
      { status: 500 }
    );
  }
}

function fireAndForgetActivationEmail(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  clientId: string,
  clientEmail: string,
  clientName: string
) {
  (async () => {
    const { data: clientRow } = await supabase
      .from("clients")
      .select(`coach:coach_id (name)`)
      .eq("id", clientId)
      .single();

    const coachName = (clientRow as { coach?: { name?: string } } | null)?.coach?.name ?? "Your Coach";
    await sendActivationEmail(clientEmail, clientName, coachName);
  })().catch((err: unknown) => {
    console.error("Failed to send activation email:", err instanceof Error ? err.message : "Unknown error");
  });
}
