import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";
import { apiRateLimit } from "@/lib/rate-limit";
import type { GetCheckInsResponse } from "@/types/check-in";
import { mapCheckInFromDatabase, type CheckInRow } from "@/types/database";

export async function GET(request: NextRequest) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // First, get all client IDs for this coach
    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("coach_id", coachId);

    if (!clients || clients.length === 0) {
      return NextResponse.json({ checkIns: [], total: 0 }, { status: 200 });
    }

    // @ts-expect-error - Database type inference issue
    const clientIds = clients.map((c) => c.id);

    // Fetch all unreviewed check-ins (status = 'ai_processed') for these clients
    const { data: checkInsData, error } = await supabaseAdmin
      .from("check_ins")
      .select(
        `
        *,
        client:clients!check_ins_client_id_fkey (
          id,
          name,
          email,
          avatar_url
        )
      `
      )
      .eq("status", "ai_processed")
      .in("client_id", clientIds)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Error fetching unreviewed check-ins:", error);
      return NextResponse.json(
        { error: "Failed to fetch unreviewed check-ins" },
        { status: 500 }
      );
    }

    // Type the relational query result properly
    type CheckInWithClient = CheckInRow & {
      client: {
        id: string;
        name: string;
        email: string;
        avatar_url: string | null;
      } | null;
    };

    // Map the database rows to CheckIn objects using the mapper function
    const checkIns = (checkInsData || []).map((row) =>
      mapCheckInFromDatabase(row as CheckInWithClient)
    );

    const response: GetCheckInsResponse = {
      checkIns,
      total: checkIns.length,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error in unreviewed check-ins endpoint:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
