import { NextRequest, NextResponse } from "next/server";
import { getCheckInById } from "@/services/check-in-service";
import { supabaseAdmin } from "@/services/supabase-client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get check-in with all fields
    const checkIn = await getCheckInById(id);

    if (!checkIn) {
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      );
    }

    // Get client info
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("id, name, email, avatar_url")
      .eq("id", checkIn.clientId)
      .single();

    if (clientError) {
      console.error("Error fetching client:", clientError);
    }

    return NextResponse.json({
      checkIn,
      client: client || null,
    });
  } catch (error) {
    console.error("Error fetching check-in:", error);
    return NextResponse.json(
      { error: "Failed to fetch check-in" },
      { status: 500 }
    );
  }
}
