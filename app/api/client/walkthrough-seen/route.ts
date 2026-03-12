import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { createServerSupabaseClient } from "@/lib/supabase-server";

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

    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from("clients")
      .update({ walkthrough_completed_at: new Date().toISOString() })
      .eq("id", clientId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking walkthrough as seen:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to update" },
      { status: 500 }
    );
  }
}
