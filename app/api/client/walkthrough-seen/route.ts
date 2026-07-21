import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { supabaseAdmin } from "@/services/supabase-admin";

export async function POST(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // Scope is explicit and server-derived: auth.clientId comes from
    // requireClientAuth -> getAuthenticatedClientId(request), which resolves
    // clients.id from the server-validated JWT. It is never user-supplied, and
    // this .eq() is what keeps the admin write narrow now that RLS no longer
    // constrains it.
    const { error } = await supabaseAdmin
      .from("clients")
      .update({ walkthrough_completed_at: new Date().toISOString() })
      .eq("id", auth.clientId);

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
