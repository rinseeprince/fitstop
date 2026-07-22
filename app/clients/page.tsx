"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { AppLayout } from "@/components/app-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddClientDialog } from "@/components/add-client-dialog";
import { OverdueBanner } from "@/components/clients/check-in/overdue-banner";
import { PendingIntakeBanner } from "@/components/coach/pending-intake-banner";
import { Search, AlertCircle, Clock, ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import type { ClientWithCheckInInfo } from "@/services/client-service";
import { useOverdueClients } from "@/hooks/use-check-in-data";

type ClientStatus = "invited" | "awaiting_review" | "awaiting_activation" | "active" | "inactive";

const statusBadgeClass: Record<ClientStatus, string> = {
  invited: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
  awaiting_review: "bg-[rgba(13,148,136,0.05)] text-[#5a7d82]",
  awaiting_activation: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
  active: "bg-[rgba(13,148,136,0.08)] text-[#0d9488]",
  inactive: "bg-[rgba(0,0,0,0.03)] text-[#93b0b4]",
};

const statusLabel: Record<ClientStatus, string> = {
  invited: "Invited",
  awaiting_review: "Intake Review",
  awaiting_activation: "Awaiting Activation",
  active: "Active",
  inactive: "Inactive",
};

import { swrFetcher } from "@/lib/swr-fetcher";

export default function ClientsPage() {
  const { data, error, isLoading, mutate } = useSWR<{ clients: ClientWithCheckInInfo[] }>(
    "/api/clients",
    swrFetcher,
    { revalidateOnFocus: false }
  );
  const clients = data?.clients ?? [];

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "onboarding" | ClientStatus>("all");
  const { clients: overdueClients } = useOverdueClients();

  const isClientOverdue = (clientId: string) => {
    return overdueClients.some((c) => c.id === clientId);
  };

  const getClientDaysOverdue = (clientId: string) => {
    const overdueClient = overdueClients.find((c) => c.id === clientId);
    return overdueClient?.daysOverdue || 0;
  };

  const formatLastCheckIn = (date?: string): string => {
    if (!date) return "Never";

    const now = new Date();
    const checkInDate = new Date(date);
    const diffInMs = now.getTime() - checkInDate.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) return "Today";
    if (diffInDays === 1) return "1 day ago";
    if (diffInDays < 7) return `${diffInDays} days ago`;
    if (diffInDays < 30) {
      const weeks = Math.floor(diffInDays / 7);
      return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
    }
    const months = Math.floor(diffInDays / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  };

  const getClientStatus = (client: ClientWithCheckInInfo): ClientStatus => {
    if (!client.active) return "inactive";
    switch (client.onboardingStatus) {
      case "pending_intake": return "invited";
      case "intake_completed": return "awaiting_review";
      case "setup_in_progress": return "awaiting_activation";
      default: return "active";
    }
  };

  const filteredClients = useMemo(() => {
    let result = [...clients];

    if (activeFilter === "onboarding") {
      result = result.filter((client) => {
        const status = getClientStatus(client);
        return status === "invited" || status === "awaiting_review" || status === "awaiting_activation";
      });
    } else if (activeFilter !== "all") {
      result = result.filter((client) => {
        const status = getClientStatus(client);
        return status === activeFilter;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (client) =>
          client.name.toLowerCase().includes(query) ||
          client.email.toLowerCase().includes(query)
      );
    }

    return result;
  }, [clients, activeFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    return {
      all: clients.length,
      active: clients.filter((c) => getClientStatus(c) === "active").length,
      onboarding: clients.filter((c) => {
        const s = getClientStatus(c);
        return s === "invited" || s === "awaiting_review" || s === "awaiting_activation";
      }).length,
      inactive: clients.filter((c) => !c.active).length,
    };
  }, [clients]);

  const pageHeader = (
    <PageHeader
      title="Clients"
      description="Manage and track your client relationships"
    />
  );

  return (
    <AppLayout pageHeader={pageHeader} headerActions={<AddClientDialog onClientAdded={() => mutate()} />}>
      <div className="space-y-6">
        {/* Pending Onboarding Banner */}
        <PendingIntakeBanner />

        {/* Overdue Banner */}
        <OverdueBanner />

        {/* Search and Filters */}
        <div className="bg-white rounded-[6px] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#93b0b4]" strokeWidth={1.5} />
              <Input
                placeholder="Search clients..."
                className="pl-10 border-[rgba(13,148,136,0.08)] rounded-[6px] text-[#0c1a1e] placeholder:text-[#93b0b4] focus:border-[#0d9488] focus:ring-[#0d9488]/20"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="bg-[rgba(13,148,136,0.05)] p-[2px] rounded-[6px] inline-flex">
              {[
                { key: "all" as const, label: `All (${statusCounts.all})` },
                { key: "active" as const, label: `Active (${statusCounts.active})` },
                { key: "onboarding" as const, label: `Onboarding (${statusCounts.onboarding})` },
                { key: "inactive" as const, label: `Inactive (${statusCounts.inactive})` },
              ].map((tab) => {
                const isActive = activeFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveFilter(tab.key)}
                    className={`px-4 py-1.5 text-sm rounded-[4px] transition-all ${
                      isActive
                        ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)] font-semibold"
                        : "text-[#5a7d82] font-medium hover:text-[#0c1a1e]"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="bg-white rounded-[6px] p-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="w-5 h-5 border-2 border-[rgba(13,148,136,0.08)] border-t-[#0d9488] rounded-full animate-spin" />
              <p className="text-sm text-[#5a7d82]">Loading clients...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="bg-white rounded-[6px] p-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="w-16 h-16 bg-[rgba(185,28,28,0.08)] rounded-full flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-[#b91c1c]" strokeWidth={1.5} />
              </div>
              <div className="text-center space-y-1">
                <p className="text-lg font-semibold text-[#0c1a1e]">Failed to load clients</p>
                <p className="text-sm text-[#5a7d82]">Please try again</p>
              </div>
              <Button
                onClick={() => mutate()}
                className="bg-[#0d9488] hover:bg-[#0d9488]/90 text-white"
              >
                Try Again
              </Button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredClients.length === 0 && (
          <div className="bg-white rounded-[6px] p-6">
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
              <div className="w-16 h-16 bg-[rgba(13,148,136,0.05)] rounded-full flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-[#93b0b4]" strokeWidth={1.5} />
              </div>
              <h3 className="text-lg font-semibold text-[#0c1a1e] mb-2">
                {searchQuery || activeFilter !== "all"
                  ? "No clients found"
                  : "No clients yet"}
              </h3>
              <p className="text-sm text-[#5a7d82] mb-6 max-w-sm">
                {searchQuery || activeFilter !== "all"
                  ? "Try adjusting your search or filters"
                  : "Get started by adding your first client to manage their training and nutrition."}
              </p>
              {!searchQuery && activeFilter === "all" && (
                <AddClientDialog
                  onClientAdded={() => mutate()}
                  trigger={
                    <Button className="bg-[#0d9488] hover:bg-[#0d9488]/90 text-white">
                      Add Your First Client
                    </Button>
                  }
                />
              )}
            </div>
          </div>
        )}

        {/* Client List */}
        {!isLoading && !error && filteredClients.length > 0 && (
          <div className="space-y-3">
            {filteredClients.map((client) => {
              const initials = client.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase();
              const isOverdue = isClientOverdue(client.id);
              const daysOverdue = getClientDaysOverdue(client.id);
              const status = getClientStatus(client);

              return (
                <Link
                  key={client.id}
                  href={`/clients/${client.id}`}
                  className="flex items-center gap-4 p-4 bg-white rounded-[6px] transition-all duration-150 cursor-pointer group hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
                >
                  {/* Avatar */}
                  <div
                    className="w-12 h-12 rounded-[6px] flex items-center justify-center flex-shrink-0 text-white text-sm font-bold"
                    style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
                  >
                    {initials}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-[#0c1a1e]">{client.name}</h4>
                      {isOverdue && (
                        <span className="inline-flex items-center gap-1 rounded-[4px] bg-[rgba(245,158,11,0.07)] px-2 py-0.5 text-[11px] font-medium text-[#d97706]">
                          <Clock className="w-3 h-3" strokeWidth={1.5} />
                          {daysOverdue}d overdue
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#5a7d82] truncate">
                      Last check-in: {formatLastCheckIn(client.lastCheckInDate)}
                    </p>
                  </div>

                  {/* Reactivate (undo Remove) — only for deactivated clients */}
                  {status === "inactive" && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        await fetch(`/api/clients/${client.id}/reactivate`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                        });
                        mutate();
                      }}
                      className="inline-flex items-center rounded-[4px] border border-[#0d9488] px-2 py-0.5 text-[11px] font-medium text-[#0d9488] hover:bg-[rgba(13,148,136,0.08)]"
                    >
                      Reactivate
                    </button>
                  )}

                  {/* Status Badge */}
                  <span className={`inline-flex items-center rounded-[4px] px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass[status]}`}>
                    {statusLabel[status]}
                  </span>

                  {/* Arrow */}
                  <ChevronRight className="w-4 h-4 text-[#93b0b4] group-hover:text-[#5a7d82] transition-colors" strokeWidth={1.5} />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
