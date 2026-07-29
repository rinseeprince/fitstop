"use client";

import { useCallback } from "react";
import { useSWRConfig } from "swr";

/**
 * Invalidator for a client's blocks area.
 *
 * `PUT`/`DELETE /api/clients/[id]/phases` writes data served by TWO areas, so
 * per CONVENTIONS §7 every block write calls two invalidators:
 *
 *   - this one, for `/api/clients/[id]/phases` — whose `nutritionStale` flag
 *     Task 3.6's "Nutrition is out of date" row reads;
 *   - `useInvalidateClientGoals`, because the goals GET carries `phases` as a
 *     sibling key (`app/api/clients/[id]/goals/route.ts:37-52`), which is where
 *     the Overview, the Metrics page and the nutrition builder read them.
 *
 * Deliberately a separate invalidator rather than widening the goals one: §7
 * matches an API *area*, and folding two endpoints into one matcher hides that
 * a write touches both.
 *
 * There is no reader hook here yet — 3.6 adds the first one. The invalidator
 * ships now because the alternative is a write path that silently leaves a
 * later reader stale, which is the exact gap §7 exists to close.
 */
export function clientPhasesKeyPrefix(clientId: string) {
  return `/api/clients/${clientId}/phases`;
}

export function useInvalidateClientPhases() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" && key.startsWith(clientPhasesKeyPrefix(clientId))
      ),
    [mutate]
  );
}
