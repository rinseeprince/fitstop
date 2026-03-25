import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";

const markSeenSchema = z.object({
  phaseId: z.string().uuid(),
});

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

    // Find the most recent completed phase with unseen completion
    // New columns (coach_reflection, phase_summary, completion_seen) added in migration 067
    // but not yet in generated types - cast to access them
    const { data: phase, error } = (await supabaseAdmin
      .from("phases")
      .select("id, name, coach_reflection, phase_summary, end_date")
      .eq("client_id", clientId)
      .eq("status", "completed")
      .not("phase_summary", "is", null)
      .eq("completion_seen", false)
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        name: string;
        coach_reflection: string | null;
        phase_summary: Record<string, unknown> | null;
        end_date: string | null;
      } | null;
      error: { message: string } | null;
    };

    if (error) {
      console.error("Error fetching phase completion:", error);
      return NextResponse.json(
        { error: "Failed to fetch phase completion" },
        { status: 500 }
      );
    }

    if (!phase) {
      return NextResponse.json(
        { success: false, error: "No pending completion" },
        { status: 404 }
      );
    }

    // Look up next phase name from summary if available
    const summary = phase.phase_summary as Record<string, unknown> | null;
    const nextPhaseId = summary?.nextPhaseId as string | undefined;
    let nextPhaseName: string | null = null;

    if (nextPhaseId) {
      const { data: nextPhase } = await supabaseAdmin
        .from("phases")
        .select("name")
        .eq("id", nextPhaseId)
        .maybeSingle();
      nextPhaseName = nextPhase?.name ?? null;
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          phaseId: phase.id,
          phaseName: phase.name,
          coachReflection: phase.coach_reflection,
          phaseSummary: summary,
          endDate: phase.end_date,
          nextPhaseName,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching phase completion:", error);
    return NextResponse.json(
      { error: "Failed to fetch phase completion" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const clientId = await getAuthenticatedClientId();
    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validation = markSeenSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    // Scoped to client_id for IDOR prevention
    // completion_seen column added in migration 067 - not yet in generated types
    const { error } = await supabaseAdmin
      .from("phases")
      .update({ completion_seen: true } as never)
      .eq("id", validation.data.phaseId)
      .eq("client_id", clientId);

    if (error) {
      console.error("Error marking phase completion as seen:", error);
      return NextResponse.json(
        { error: "Failed to mark completion as seen" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error marking phase completion as seen:", error);
    return NextResponse.json(
      { error: "Failed to mark completion as seen" },
      { status: 500 }
    );
  }
}
