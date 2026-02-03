import { NextRequest, NextResponse } from "next/server"
import { acceptInvitation } from "@/services/invitation-service"

export async function POST(request: NextRequest) {
  try {
    const { clientId, userId } = await request.json()

    if (!clientId || !userId) {
      return NextResponse.json(
        { success: false, error: "Missing clientId or userId" },
        { status: 400 }
      )
    }

    await acceptInvitation(clientId, userId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error accepting invitation:", error)
    return NextResponse.json(
      { success: false, error: "Failed to accept invitation" },
      { status: 500 }
    )
  }
}