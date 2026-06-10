import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { updateCoachSettingsSchema } from "@/lib/validations/coach";
import { updateCoachSettings } from "@/services/coach-service";

// PATCH /api/coach/settings - Update the authenticated coach's settings.
// Written for the device timezone auto-sync (Session 7.81); no manual picker
// exists for this endpoint.
export async function PATCH(request: NextRequest) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfResult = await requireCSRFProtection(request);
  if (csrfResult) return csrfResult;

  const coachId = await getAuthenticatedCoachId(request);
  if (!coachId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const parsed = updateCoachSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      },
      { status: 400 }
    );
  }

  if (!Intl.supportedValuesOf("timeZone").includes(parsed.data.timezone)) {
    return NextResponse.json(
      { success: false, error: "Invalid timezone" },
      { status: 400 }
    );
  }

  try {
    const coach = await updateCoachSettings(coachId, parsed.data);
    return NextResponse.json({ success: true, data: coach });
  } catch (error) {
    console.error("Error updating coach settings:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
