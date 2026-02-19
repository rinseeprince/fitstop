import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getClientResources } from "@/services/content-service";
import { clientApiRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const supabase = await createServerSupabaseClient();
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get client profile
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, coach_id")
      .eq("user_id", user.id)
      .single();

    if (clientError || !client) {
      return NextResponse.json(
        { success: false, error: "Client profile not found" },
        { status: 404 }
      );
    }

    // Fetch client resources (both assigned and library content)
    const resources = await getClientResources(client.id, client.coach_id);

    return NextResponse.json({
      success: true,
      data: resources,
    });
  } catch (error) {
    console.error("Error fetching client resources:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch resources" },
      { status: 500 }
    );
  }
}