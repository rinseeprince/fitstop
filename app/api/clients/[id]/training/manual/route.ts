import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { createSavedPlanManual } from "@/services/coach-library-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import type { ManualSessionDraft } from "@/types/training";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { z } from "zod";

const manualExerciseSchema = z.object({
  name: z.string().min(1),
  sets: z.number().min(1).max(20),
  repsTarget: z.string().optional(),
  rpeTarget: z.number().min(1).max(10).optional(),
  restSeconds: z.number().optional(),
  notes: z.string().optional(),
});

const manualSessionSchema = z.object({
  tempId: z.string(),
  name: z.string().min(1),
  dayOfWeek: z.string().optional(),
  focus: z.string().optional(),
  exercises: z.array(manualExerciseSchema),
});

const manualPlanSchema = z.object({
  name: z.string().min(1).default("Custom Training Plan"),
  splitType: z.enum(["push_pull_legs", "upper_lower", "full_body", "bro_split", "push_pull", "custom"]).default("custom"),
  frequencyPerWeek: z.number().min(1).max(7),
  sessions: z.array(manualSessionSchema).min(1),
  phaseId: z.string().uuid().optional(),
});

// POST - Create manual training plan as a library draft
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = manualPlanSchema.safeParse(body);

    if (!validation.success) {
      console.error("Validation error:", validation.error.errors);
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    const { name, splitType, sessions } = validation.data;

    // Save as a library draft (coach previews/edits before applying to client)
    // Zod-parsed sessions match ManualSessionDraft shape (tempId is only used client-side)
    const savedPlanId = await createSavedPlanManual(coachId, name, splitType, sessions as ManualSessionDraft[]);

    return NextResponse.json({ success: true, savedPlanId }, { status: 201 });
  } catch (error) {
    console.error("Error creating manual plan:", error);
    return NextResponse.json(
      { error: "Failed to create training plan" },
      { status: 500 }
    );
  }
}
