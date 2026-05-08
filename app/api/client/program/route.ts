import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientProgram } from "@/services/client-program-service";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await getClientProgram(auth.clientId);
    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching client program:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch program" },
      { status: 500 }
    );
  }
}
