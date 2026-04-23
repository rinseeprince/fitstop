import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getClientResources } from "@/services/content-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // Resolve coach_id for this client (getClientResources needs both ids)
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("coach_id")
      .eq("id", auth.clientId)
      .single();

    if (clientError || !client) {
      return NextResponse.json(
        { success: false, error: "Client profile not found" },
        { status: 404 }
      );
    }

    // Fetch client resources (both assigned and library content)
    const resources = await getClientResources(auth.clientId, client.coach_id);

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