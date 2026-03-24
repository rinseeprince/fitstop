import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getActiveRoadmap,
  createRoadmap,
  updateRoadmap,
  deleteRoadmap,
} from "@/services/roadmap-service";
import {
  createRoadmapSchema,
  updateRoadmapSchema,
} from "@/lib/validations/roadmap";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const roadmap = await getActiveRoadmap(clientId);

    if (!roadmap) {
      return NextResponse.json(
        { success: false, error: "No active roadmap found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: roadmap }, { status: 200 });
  } catch (error) {
    console.error("Error fetching roadmap:", error);
    return NextResponse.json(
      { error: "Failed to fetch roadmap" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const body = await request.json();
    const validation = createRoadmapSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const roadmap = await createRoadmap(clientId, auth.coachId, validation.data);

    return NextResponse.json(
      { success: true, data: roadmap },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create roadmap";
    if (message.includes("already has an active roadmap")) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
    console.error("Error creating roadmap:", error);
    return NextResponse.json(
      { error: "Failed to create roadmap" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const body = await request.json();
    const validation = updateRoadmapSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const roadmap = await getActiveRoadmap(clientId);
    if (!roadmap) {
      return NextResponse.json(
        { success: false, error: "No active roadmap found" },
        { status: 404 }
      );
    }

    const updated = await updateRoadmap(roadmap.id, validation.data);

    return NextResponse.json(
      { success: true, data: updated },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating roadmap:", error);
    return NextResponse.json(
      { error: "Failed to update roadmap" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const roadmap = await getActiveRoadmap(clientId);
    if (!roadmap) {
      return NextResponse.json(
        { success: false, error: "No active roadmap found" },
        { status: 404 }
      );
    }

    await deleteRoadmap(roadmap.id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete roadmap";
    if (message.includes("phases that were started or completed")) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
    console.error("Error deleting roadmap:", error);
    return NextResponse.json(
      { error: "Failed to delete roadmap" },
      { status: 500 }
    );
  }
}
