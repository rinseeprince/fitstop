"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlanEdit } from "@/hooks/use-plan-edit";
import type { PlanForEditing } from "@/services/plan-edit-service";
import type { WindowCap } from "@/services/program-event-walk";
import { planForEditingToDraft } from "./placed-serialize";
import type { EditableDays } from "./program-builder-lock-model";
import type { ProgramBuilderState } from "./use-program-builder-state";

// The plan editor's draft source for ProgramDraftProvider: seeds the working
// tree ONCE from the editor's read (the read is fresh per open, and the
// overlay keys the provider by plan), and holds what the seed brought with
// it: the editable days, today's position, the plan's limit and the version
// the save sends back.

type PlanEditorSeedInfo = {
  editableDays: EditableDays | null;
  todayPosition: number | null;
  limit: WindowCap | null;
  version: string | null;
};

const EMPTY_SEED: PlanEditorSeedInfo = {
  editableDays: null,
  todayPosition: null,
  limit: null,
  version: null,
};

/** The server's own sentence when it sent one, else the generic one. */
function loadErrorMessage(error: unknown): string {
  const info = (error as { info?: { error?: unknown } } | null)?.info;
  return typeof info?.error === "string"
    ? info.error
    : "This plan couldn't be loaded for editing";
}

export function usePlacedPlanSource(params: {
  enabled: boolean;
  clientId: string | null;
  placedPlanId: string | null;
  state: ProgramBuilderState;
  setMode: (mode: "view" | "edit") => void;
}) {
  const { enabled, clientId, placedPlanId, state, setMode } = params;
  const { planForEditing, isLoading, error, mutate } = usePlanEdit(
    enabled ? clientId : null,
    enabled ? placedPlanId : null,
  );
  const { draft, seed } = state;
  const [seedInfo, setSeedInfo] = useState<PlanEditorSeedInfo>(EMPTY_SEED);

  const applySeed = useCallback(
    (read: PlanForEditing) => {
      const seeded = planForEditingToDraft(read);
      seed(seeded.draft);
      setSeedInfo({
        editableDays: seeded.editableDays,
        todayPosition: seeded.todayPosition,
        limit: read.limit,
        version: read.version,
      });
      // The editor opens ready to edit — view is one toggle away.
      setMode("edit");
    },
    [seed, setMode],
  );

  useEffect(() => {
    if (enabled && planForEditing && !draft) applySeed(planForEditing);
  }, [enabled, planForEditing, draft, applySeed]);

  // Discard changes = re-seed from the read the draft came from (uids
  // regenerate, so an open session editor closes itself).
  const discard = useCallback(() => {
    if (planForEditing) applySeed(planForEditing);
  }, [planForEditing, applySeed]);

  // A refused save: read the calendar again and re-seed from it. Unsaved edits
  // go — the coach chose "Reload and discard edits".
  const reload = useCallback(async () => {
    const next = await mutate();
    if (next?.data) applySeed(next.data);
  }, [mutate, applySeed]);

  // After a save that edits landed during: the save wrote the calendar, so the
  // held version is stale. Take the fresh one WITHOUT re-seeding, or the edits
  // kept for a second save would go.
  const refreshVersion = useCallback(async () => {
    const next = await mutate();
    if (next?.data) {
      const fresh = next.data.version;
      setSeedInfo((prev) => ({ ...prev, version: fresh }));
    }
  }, [mutate]);

  return {
    isLoading: enabled && isLoading,
    loadError: enabled && error ? loadErrorMessage(error) : null,
    ...seedInfo,
    discard,
    reload,
    refreshVersion,
  };
}
