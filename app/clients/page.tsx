"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ChevronRight, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AddClientDialog } from "@/components/add-client-dialog";
import { LibrarySearchInput } from "@/components/programs/shared/library-search-input";
import { RosterShell } from "@/components/clients/roster/roster-shell";
import {
  CHIP_BASE_CLASS,
  LATE_CHIP_CLASS,
  ROSTER_STATUS_CHIP,
  ROSTER_STATUS_LABEL,
} from "@/components/clients/roster/roster-status";
import {
  FOCUS_RING,
  MONO,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useRoster } from "@/hooks/use-roster";
import { matchesRosterView, resolveRosterView } from "@/lib/roster-views";

function ClientsRoster() {
  const searchParams = useSearchParams();
  const view = resolveRosterView(searchParams.get("view"));

  const { rows, counts, isLoading, isError, refresh } = useRoster();
  const [searchQuery, setSearchQuery] = useState("");
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const handleReactivate = async (clientId: string) => {
    setReactivatingId(clientId);
    try {
      const res = await fetch(`/api/clients/${clientId}/reactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        toast.error("Couldn't reactivate this client. Please try again.");
        return;
      }
      toast.success("Client reactivated.");
    } catch {
      toast.error("Couldn't reactivate this client. Please try again.");
      return;
    } finally {
      setReactivatingId(null);
    }
    // Outside the try on purpose: a failed revalidation is not a failed
    // reactivation, and reporting it as one contradicted the toast above it.
    void refresh();
  };

  const visibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesRosterView(row, view)) return false;
      if (!query) return true;
      return (
        row.client.name.toLowerCase().includes(query) ||
        row.client.email.toLowerCase().includes(query)
      );
    });
  }, [rows, view, searchQuery]);

  return (
    <RosterShell
      activeView={view}
      counts={counts}
      onClientAdded={() => void refresh()}
    >
      <div className="space-y-5">
        <div className="rounded-[6px] bg-white p-4">
          <LibrarySearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search clients"
          />
        </div>

        {isLoading && (
          <div className="rounded-[6px] bg-white p-6">
            <div className="flex flex-col items-center justify-center space-y-3 py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[rgba(13,148,136,0.08)] border-t-[#0d9488]" />
              <p className="text-sm text-[#5a7d82]">Loading clients</p>
            </div>
          </div>
        )}

        {isError && !isLoading && (
          <div className="rounded-[6px] bg-white p-6">
            <div className="flex flex-col items-center justify-center space-y-3 py-12 text-center">
              <AlertCircle className="h-8 w-8 text-[#93b0b4] opacity-50" strokeWidth={1.5} />
              <p className="text-sm text-[#5a7d82]">Could not load your clients</p>
              <Button
                onClick={() => void refresh()}
                className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {!isLoading && !isError && visibleRows.length === 0 && (
          <div className="rounded-[6px] bg-white p-6">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="mb-2 h-8 w-8 text-[#93b0b4] opacity-50" strokeWidth={1.5} />
              <p className="text-sm text-[#5a7d82]">
                {counts.all === 0 ? "No clients yet" : "No clients in this view"}
              </p>
              <p className="mt-1 text-xs text-[#93b0b4]">
                {counts.all === 0
                  ? "Invite your first client to start coaching them"
                  : "Try another view, or a shorter search"}
              </p>
              {counts.all === 0 && (
                <AddClientDialog
                  onClientAdded={() => void refresh()}
                  trigger={
                    <button
                      type="button"
                      className={cn(
                        "mt-4 inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75]",
                        FOCUS_RING,
                      )}
                    >
                      Invite client
                    </button>
                  }
                />
              )}
            </div>
          </div>
        )}

        {!isLoading && !isError && visibleRows.length > 0 && (
          <div className="space-y-3">
            {visibleRows.map(({ client, status, daysOverdue }) => {
              const initials = client.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase();
              const isInactive = status === "inactive";

              const rowInner = (
                <>
                  <div
                    className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[6px] text-sm font-bold text-white"
                    style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
                  >
                    {initials}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-[#0c1a1e]">{client.name}</h4>
                    <p className="truncate text-xs text-[#93b0b4]">{client.email}</p>
                  </div>

                  {isInactive && (
                    <button
                      type="button"
                      disabled={reactivatingId === client.id}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void handleReactivate(client.id);
                      }}
                      className={cn(
                        "inline-flex items-center rounded-[6px] border border-[rgba(13,148,136,0.08)] px-2.5 py-1 text-xs font-medium text-[#0d9488] transition-colors hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55] disabled:opacity-50",
                        FOCUS_RING,
                      )}
                    >
                      {reactivatingId === client.id ? "Reactivating" : "Reactivate"}
                    </button>
                  )}

                  {daysOverdue > 0 && (
                    <span className={cn(CHIP_BASE_CLASS, LATE_CHIP_CLASS, MONO)}>
                      {daysOverdue}d late
                    </span>
                  )}

                  <span className={cn(CHIP_BASE_CLASS, ROSTER_STATUS_CHIP[status])}>
                    {ROSTER_STATUS_LABEL[status]}
                  </span>

                  {!isInactive && (
                    <ChevronRight
                      className="h-4 w-4 text-[#93b0b4] transition-colors group-hover:text-[#5a7d82]"
                      strokeWidth={1.5}
                    />
                  )}
                </>
              );

              // An inactive client's detail page 404s (getClientById is
              // active-filtered), so its row does NOT navigate — the only
              // action is Reactivate.
              return isInactive ? (
                <div
                  key={client.id}
                  className="flex items-center gap-4 rounded-[6px] bg-white p-4"
                >
                  {rowInner}
                </div>
              ) : (
                <Link
                  key={client.id}
                  href={`/clients/${client.id}`}
                  className="group flex cursor-pointer items-center gap-4 rounded-[6px] bg-white p-4 transition-all duration-150 hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
                >
                  {rowInner}
                </Link>
              );
            })}
          </div>
        )}
      </div>
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
