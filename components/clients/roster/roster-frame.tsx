"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/page-loading";
import { RosterShell } from "./roster-shell";
import { RosterStatBand } from "./roster-stat-band";
import { RosterTable } from "./roster-table";
import type { RosterCounts, RosterRow, RosterView } from "@/lib/roster-views";

export interface RosterFrameProps {
  /**
   * null = ?view= is not readable yet. That is the page's Suspense fallback —
   * the thing static prerendering emits, since a prerender cannot know the
   * query string. Nothing is highlighted, the header is neutral and the body
   * shows the loading state; hydration re-renders with the resolved view.
   */
  view: RosterView | null;
  rows: RosterRow[];
  counts: RosterCounts;
  isLoading: boolean;
  isError: boolean;
  onRosterChanged: () => void;
}

/**
 * The whole /clients surface, parameterised by the resolved view — including
 * "not resolved yet". The split exists for static prerendering: only
 * ?view=-dependent rendering may wait on the URL, never the frame
 * (ARCHITECTURE → "Coach route group": chrome renders with the route).
 */
export function RosterFrame({
  view,
  rows,
  counts,
  isLoading,
  isError,
  onRosterChanged,
}: RosterFrameProps) {
  return (
    <RosterShell activeView={view} counts={counts} onClientAdded={onRosterChanged}>
      {view === null || isLoading ? (
        <PageLoading label="Loading clients…" />
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
            onClick={onRosterChanged}
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
            onRosterChanged={onRosterChanged}
          />
        </div>
      )}
    </RosterShell>
  );
}
