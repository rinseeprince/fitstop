import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase-admin";
import { mapCheckInFromDatabase, type CheckInRow } from "@/types/database";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get check-in with client info in a single query using relational syntax
    const { data, error } = await supabaseAdmin
      .from("check_ins")
      .select(
        `
        *,
        clients!client_id (
          id,
          name,
          email,
          avatar_url
        )
      `
      )
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error fetching check-in:", error);
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Check-in not found" },
        { status: 404 }
      );
    }

    // Type the relational query result properly
    type CheckInWithClient = CheckInRow & {
      clients: {
        id: string;
        name: string;
        email: string;
        avatar_url: string | null;
      } | null;
    };

    const checkInData = data as CheckInWithClient;

    // Use mapper function to transform database row to application type
    const checkIn = mapCheckInFromDatabase(checkInData);

    return NextResponse.json({
      checkIn,
      client: checkInData.clients || null,
    });
  } catch (error) {
    console.error("Error fetching check-in:", error);
    return NextResponse.json(
      { error: "Failed to fetch check-in" },
      { status: 500 }
    );
  }
}
