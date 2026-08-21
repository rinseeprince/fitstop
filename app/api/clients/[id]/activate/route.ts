import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { activateClientSchema } from "@/lib/validations/client-intake";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { sendActivationEmail } from "@/services/email-service";
import { sendInvitation } from "@/services/invitation-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { recordClientStart } from "@/services/client-start-service";
import { getClientTodayString } from "@/services/today-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
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

    // Activation IS the origin, and three denominators are measured from it:
    // the check-in period clamp, the weekly-nutrition partial first week, and
    // the no-engagement grace (which returns null — silently OFF — without it).
    //
    // The coach's picked date wins: the dialog prefills their today and they
    // may backdate it ("we actually started last Monday"). A stored date is
    // kept rather than overwritten, so nothing can null an origin that already
    // exists. The client-timezone fallback is for a caller that sends no date
    // at all — a start date sits on the client's calendar, not their coach's.
    const startsOn =
      validation.data.startDate ??
      client.startDate ??
      (await getClientTodayString(clientId));

    const { error } = await supabase
      .from("clients")
      .update(updateData)
      .eq("id", clientId);

    if (error) {
      console.error("Supabase update error:", error.message);
      throw new Error("Failed to activate client");
    }

    // The origin, and the measurements taken on it. Written AFTER the status
    // flip so a failure here leaves an activated client rather than a
    // half-activated one — and surfaced rather than swallowed, because a
    // client whose journey has no start is the state this exists to prevent.
    await recordClientStart(clientId, { startsOn, coachId });

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.CLIENT_ACTIVATE,
      targetTable: "clients",
      targetId: clientId,
      clientId,
      request,
    });

    // Send activation email (fire-and-forget)
    fireAndForgetActivationEmail(supabase, clientId, client.email, client.name);

    // For manual-path clients without an account, auto-send invite (fire-and-forget)
    fireAndForgetInviteIfNeeded(supabase, clientId);

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

function fireAndForgetInviteIfNeeded(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  clientId: string
) {
  (async () => {
    // Check if client already has an auth account
    const { data } = await supabase
      .from("clients")
      .select("user_id")
      .eq("id", clientId)
      .single();

    if (data && !(data as { user_id: string | null }).user_id) {
      const result = await sendInvitation(clientId);
      if (!result.success) {
        console.warn("Auto-invite failed at activation — coach can resend from profile:", result.error);
      }
    }
  })().catch((err: unknown) => {
    console.error("Failed to auto-send invite at activation:", err instanceof Error ? err.message : "Unknown error");
  });
}
