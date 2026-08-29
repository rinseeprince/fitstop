import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";
import { apiRateLimit } from "@/lib/rate-limit";
import { UNREVIEWED_CHECK_IN_STATUSES } from "@/lib/constants";
import type { GetCheckInsResponse } from "@/types/check-in";
import { mapCheckInRow } from "@/lib/mappers";
import type { CheckInRow } from "@/lib/database-helpers";

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // First, get all ACTIVE client IDs for this coach. Deactivated clients are
    // excluded for the reason `getCoachPendingIntakes` excludes them: their
    // detail page 404s (`getClientById` is active-filtered), so every consumer
    // of this queue — the bell rows, which link straight to the check-in; the
    // Clients nav badge; the roster's Ready-for-review view — would carry a row
    // that dead-ends. It also keeps the badge and the roster count equal by
    // construction rather than by two client-side filters that can drift.
    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("coach_id", coachId)
      .eq("active", true);

    if (!clients || clients.length === 0) {
      return NextResponse.json({ checkIns: [], total: 0 }, { status: 200 });
    }

    const clientIds = clients.map((c) => c.id);

    // Every unreviewed check-in for these clients — `pending` included, so a
    // check-in whose AI pass failed still reaches the bell (D2.2).
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
      .in("status", UNREVIEWED_CHECK_IN_STATUSES)
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

    // Map database rows and extract client data from the joined relation
    const checkIns = (checkInsData || []).map((row) => {
      const typed = row as CheckInWithClient;
      const mapped = mapCheckInRow(typed);
      return {
        ...mapped,
        clientName: typed.client?.name || "Unknown Client",
        clientEmail: typed.client?.email || "",
        clientAvatarUrl: typed.client?.avatar_url || null,
      };
    });

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
