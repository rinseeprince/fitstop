import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getExercisesForCoach } from "@/services/exercise-catalog-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("coach_id")
      .eq("id", auth.clientId)
      .single();

    if (clientError || !client?.coach_id) {
      return NextResponse.json(
        { success: false, error: "Client profile not found" },
        { status: 404 },
      );
    }

    const search =
      new URL(request.url).searchParams.get("search") || undefined;
    const exercises = await getExercisesForCoach(client.coach_id, search);

    return NextResponse.json(
      { success: true, exercises },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error fetching exercises:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch exercises" },
      { status: 500 },
    );
  }
}
