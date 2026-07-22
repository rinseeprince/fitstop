import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { updateSettingsSchema } from "@/lib/validations/client";
import { updateClientSettings } from "@/services/client-service";
import { toClientSelfView } from "@/lib/mappers";

// PATCH /api/client/settings - Update the authenticated client's settings
export async function PATCH(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      },
      { status: 400 }
    );
  }

  if (
    parsed.data.timezone &&
    !Intl.supportedValuesOf("timeZone").includes(parsed.data.timezone)
  ) {
    return NextResponse.json(
      { success: false, error: "Invalid timezone" },
      { status: 400 }
    );
  }

  try {
    const client = await updateClientSettings(auth.clientId, parsed.data);
    return NextResponse.json({ success: true, data: toClientSelfView(client) });
  } catch (error) {
    console.error("Error updating client settings:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
