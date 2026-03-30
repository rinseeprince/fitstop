import { NextResponse } from "next/server";
import { getActiveRoadmap } from "@/services/roadmap-service";
import type { PhaseStatus } from "@/types/roadmap";

type PhaseCheckOk = {
  ok: true;
  phaseId: string | undefined;
  phaseGoalWeight?: number | null;
  phaseGoalBodyFatPercentage?: number | null;
  phaseStartDate?: string | null;
  phaseEndDate?: string | null;
  phaseStatus?: PhaseStatus;
};
type PhaseCheckFail = { ok: false; response: NextResponse };
type PhaseCheckResult = PhaseCheckOk | PhaseCheckFail;

/**
 * Enforce phase selection when a client has an active roadmap.
 *
 * - No active roadmap → proceed without phaseId.
 * - Roadmap exists, selectable phases exist, no phaseId → 400.
 * - Roadmap exists, zero selectable phases → 400.
 * - phaseId provided but not in selectable list → 400.
 */
export async function requirePhaseSelection(
  clientId: string,
  phaseId?: string
): Promise<PhaseCheckResult> {
  const roadmap = await getActiveRoadmap(clientId);
  if (!roadmap) {
    return {
      ok: true,
      phaseId: undefined,
      phaseGoalWeight: undefined,
      phaseGoalBodyFatPercentage: undefined,
      phaseStartDate: undefined,
      phaseEndDate: undefined,
      phaseStatus: undefined,
    };
  }

  const selectable = roadmap.phases.filter(
    (p) => p.status === "planned" || p.status === "active"
  );

  if (selectable.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error:
            "This client has an active roadmap but no phases. Add a phase to the roadmap first.",
        },
        { status: 400 }
      ),
    };
  }

  if (!phaseId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error:
            "This client has an active roadmap. Please select a phase for this plan.",
        },
        { status: 400 }
      ),
    };
  }

  if (!selectable.some((p) => p.id === phaseId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Invalid phase selection." },
        { status: 400 }
      ),
    };
  }

  const matchedPhase = selectable.find((p) => p.id === phaseId)!;
  return {
    ok: true,
    phaseId,
    phaseGoalWeight: matchedPhase.phaseGoalWeight ?? null,
    phaseGoalBodyFatPercentage: matchedPhase.phaseGoalBodyFatPercentage ?? null,
    phaseStartDate: matchedPhase.startDate ?? null,
    phaseEndDate: matchedPhase.endDate ?? null,
    phaseStatus: matchedPhase.status,
  };
}
