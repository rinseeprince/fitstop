"use client";

import { Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  RosterFrame,
  type RosterFrameProps,
} from "@/components/clients/roster/roster-frame";
import { useRoster } from "@/hooks/use-roster";
import { resolveRosterView } from "@/lib/roster-views";

// The ONLY reader of ?view=. `useSearchParams` bails static prerendering out
// to the nearest Suspense boundary, so the reader sits alone behind one and
// everything else — the shell, the rail, the roster sidebar — stays in the
// prerendered HTML. Adding a `useSearchParams` call anywhere outside this
// component puts the page's static HTML back to an empty frame.
function RosterWithParams(props: Omit<RosterFrameProps, "view">) {
  const searchParams = useSearchParams();
  return (
    <RosterFrame view={resolveRosterView(searchParams.get("view"))} {...props} />
  );
}

export default function ClientsPage() {
  const { rows, counts, isLoading, isError, refresh } = useRoster();

  // Stable: useRosterActions memoises its handlers against this, and an inline
  // arrow would mint a new identity every render and defeat that.
  const handleRosterChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  const frame = {
    rows,
    counts,
    isLoading,
    isError,
    onRosterChanged: handleRosterChanged,
  };

  // The fallback is the SAME frame with the view not yet known — one component
  // invoked twice, not duplicated markup — so the prerendered page is the real
  // surface in its pending state, never a blank.
  return (
    <Suspense fallback={<RosterFrame view={null} {...frame} />}>
      <RosterWithParams {...frame} />
    </Suspense>
  );
}
