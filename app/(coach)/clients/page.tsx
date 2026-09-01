"use client";

import { Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RosterShell } from "@/components/clients/roster/roster-shell";
import { RosterStatBand } from "@/components/clients/roster/roster-stat-band";
import { RosterTable } from "@/components/clients/roster/roster-table";
import { useRoster } from "@/hooks/use-roster";
import { resolveRosterView } from "@/lib/roster-views";

function ClientsRoster() {
  const searchParams = useSearchParams();
  const view = resolveRosterView(searchParams.get("view"));
  const { rows, counts, isLoading, isError, refresh } = useRoster();

  // Stable: useRosterActions memoises its handlers against this, and an inline
  // arrow would mint a new identity every render and defeat that.
  const handleRosterChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <RosterShell
      activeView={view}
      counts={counts}
      onClientAdded={handleRosterChanged}
    >
      {isLoading ? (
        <div role="status" className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" />
          <span className="sr-only">Loading clients</span>
        </div>
      ) : isError ? (
        <div className="py-12 text-center text-[#5a7d82]">
          <AlertCircle
            className="mx-auto mb-2 h-8 w-8 opacity-50"
            strokeWidth={1.5}
          />
          <p className="text-sm">Could not load your clients</p>
          <p className="mt-1 text-xs text-[#93b0b4]">
            The roster did not come back this time
          </p>
          <Button
            onClick={() => void refresh()}
            className="mt-4 bg-[#0d9488] text-white hover:bg-[#0b7f75]"
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <RosterStatBand rows={rows} counts={counts} />
          <RosterTable
            rows={rows}
            view={view}
            onRosterChanged={handleRosterChanged}
          />
        </div>
      )}
    </RosterShell>
  );
}

export default function ClientsPage() {
  // `useSearchParams` in a statically-rendered route needs a boundary; the
  // roster's view lives in `?view=`, so the whole body sits behind one.
  return (
    <Suspense fallback={null}>
      <ClientsRoster />
    </Suspense>
  );
}
