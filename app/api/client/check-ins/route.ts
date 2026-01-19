import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientCheckIns } from "@/services/client-portal-service";
import { apiRateLimit } from "@/lib/rate-limit";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";

const checkInSchema = z.object({
  clientId: z.string().uuid(),
  mood: z.number().min(1).max(5).optional(),
  energy: z.number().min(1).max(10).optional(),
  sleep: z.number().min(1).max(10).optional(),
  stress: z.number().min(1).max(10).optional(),
  notes: z.string().nullable().optional(),
  weight: z.number().positive().nullable().optional(),
  weightUnit: z.enum(["lbs", "kg"]).optional().default("lbs"),
  bodyFatPercentage: z.number().min(0).max(100).nullable().optional(),
  workoutsCompleted: z.number().min(0).max(14).nullable().optional(),
  challenges: z.string().nullable().optional(),
  prs: z.string().nullable().optional(),
});

// GET /api/client/check-ins - Get client's check-in history
export async function GET(request: NextRequest) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const checkIns = await getClientCheckIns(clientId, { limit, offset });

    return NextResponse.json({
      success: true,
      data: checkIns,
      pagination: {
        limit,
        offset,
        count: checkIns.length,
      },
    });
  } catch (error) {
    console.error("Error fetching check-ins:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch check-ins",
      },
      { status: 500 }
    );
  }
}

// POST /api/client/check-ins - Submit a new check-in
export async function POST(request: NextRequest) {
  const rateLimitResult = apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const authenticatedClientId = await getAuthenticatedClientId();

    if (!authenticatedClientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validationResult = checkInSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input",
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    // Verify the client ID matches the authenticated user
    if (data.clientId !== authenticatedClientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 403 }
      );
    }

    // Create Supabase client
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Handle read-only error
            }
          },
        },
      }
    );

    // Insert check-in
    const { data: checkIn, error } = await supabase
      .from("check_ins")
      .insert({
        client_id: data.clientId,
        status: "pending",
        mood: data.mood,
        energy: data.energy,
        sleep: data.sleep,
        stress: data.stress,
        notes: data.notes,
        weight: data.weight,
        weight_unit: data.weightUnit,
        body_fat_percentage: data.bodyFatPercentage,
        workouts_completed: data.workoutsCompleted,
        challenges: data.challenges,
        prs: data.prs,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating check-in:", error);
      return NextResponse.json(
        { success: false, error: "Failed to submit check-in" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, data: checkIn },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error submitting check-in:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to submit check-in",
      },
      { status: 500 }
    );
  }
}
