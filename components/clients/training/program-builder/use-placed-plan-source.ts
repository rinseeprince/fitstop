"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlacedPlan } from "@/hooks/use-placed-plan";
import type { PlacedPlanForBuilder } from "@/services/plan-amendment-service";
import { placedPlanToDraft } from "./placed-serialize";
import type { ProgramBuilderState } from "./use-program-builder-state";

// The placed-plan draft source for ProgramDraftProvider: seeds the working
// tree ONCE from the amendment GET (SWR refreshes are no-ops — the overlay
// keys the provider by planId, so cross-plan cleanup is a remount), and owns
// everything the seed produced: the lock set, the row-id map, the drift token.

export type PlacedPlanSeedInfo = {
  lockedSlotUids: ReadonlySet<string>;
  fullyLocked: boolean;
  sessionIdByUid: ReadonlyMap<string, string>;
  amendmentToken: string | null;
};

const EMPTY_SEED: PlacedPlanSeedInfo = {
  lockedSlotUids: new Set(),
  fullyLocked: false,
  sessionIdByUid: new Map(),
  amendmentToken: null,
};

export function usePlacedPlanSource(params: {
  enabled: boolean;
  clientId: string | null;
  placedPlanId: string | null;
  state: ProgramBuilderState;
  setMode: (mode: "view" | "edit") => void;
}) {
  const { enabled, clientId, placedPlanId, state, setMode } = params;
  const { placedPlan, isLoading, error, mutate } = usePlacedPlan(
    enabled ? clientId : null,
    enabled ? placedPlanId : null,
  );
  const { draft, seed, isDirty } = state;

  const [seedInfo, setSeedInfo] = useState<PlacedPlanSeedInfo>(EMPTY_SEED);

  const applySeed = useCallback(
    (read: PlacedPlanForBuilder) => {
      const seeded = placedPlanToDraft(read);
      seed(seeded.draft);
      setSeedInfo({
        lockedSlotUids: new Set(seeded.lockedSlotUids),
        fullyLocked: seeded.fullyLocked,
        sessionIdByUid: seeded.sessionIdByUid,
        amendmentToken: seeded.amendmentToken,
      });
      // The amendment surface opens ready to edit — view is one toggle away.
      setMode("edit");
    },
    [seed, setMode],
  );

  useEffect(() => {
    if (!enabled || !placedPlan) return;
    if (!draft) {
      applySeed(placedPlan);
      return;
    }
    // A fresh read landing while the tree is PRISTINE re-seeds. This covers
    // reopening the editor from a stale SWR cache (the Plans-subtab hook keeps
    // the key alive, and our own last save changed the plan): the instant seed
    // uses the cached snapshot, then the mount revalidation arrives and — no
    // edits made yet — replaces it, fresh token included. Never while dirty:
    // edits always win, and real drift then surfaces as a 409 with the
    // reload-vs-keep-editing dialog.
    if (!isDirty && placedPlan.amendmentToken !== seedInfo.amendmentToken) {
      applySeed(placedPlan);
    }
  }, [enabled, placedPlan, draft, isDirty, seedInfo.amendmentToken, applySeed]);

  // Discard changes = re-seed from the last read (uids regenerate — any open
  // session editor closes itself — and locks recompute with them).
  const discard = useCallback(() => {
    if (placedPlan) applySeed(placedPlan);
  }, [placedPlan, applySeed]);

  // Drift recovery (409): refetch, then re-seed from the fresh read. Unsaved
  // edits are deliberately dropped — the coach chose "reload" in the dialog.
  const reload = useCallback(async () => {
    const next = await mutate();
    if (next) applySeed(next);
  }, [mutate, applySeed]);

  // After a save that raced mid-save edits ("kept-draft"): the amendment
  // landed, so the held token is stale — refetch it WITHOUT re-seeding, or the
  // very edits we kept would be clobbered. Locks stay valid (same boundary
  // date; a midnight flip surfaces as a 409 on the next save).
  const refreshToken = useCallback(async () => {
    const next = await mutate();
    if (next) {
      setSeedInfo((prev) => ({ ...prev, amendmentToken: next.amendmentToken }));
    }
  }, [mutate]);

  return {
    read: placedPlan,
    isLoading: enabled && isLoading,
    loadError:
      enabled && error ? "This plan couldn't be loaded for editing" : null,
    ...seedInfo,
    futureModifiedEvents: placedPlan?.futureModifiedEvents ?? [],
    discard,
    reload,
    refreshToken,
  };
}
