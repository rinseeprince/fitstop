"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { AppLayout } from "@/components/app-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AddClientDialog } from "@/components/add-client-dialog";
import { OverdueBanner } from "@/components/clients/check-in/overdue-banner";
import { PendingIntakeBanner } from "@/components/coach/pending-intake-banner";
import { Search, AlertCircle, Clock, ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import type { ClientWithCheckInInfo } from "@/services/client-service";
import { useOverdueClients } from "@/hooks/use-check-in-data";

type ClientStatus = "active" | "inactive";

const fetcher = async (url: string) => { const r = await fetch(url); return r.json() };

export default function ClientsPage() {
  const { data, error, isLoading, mutate } = useSWR<{ clients: ClientWithCheckInInfo[] }>(
    "/api/clients",
    fetcher,
    { revalidateOnFocus: false }
  );
  const clients = data?.clients ?? [];

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | ClientStatus>("all");
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
    return client.active ? "active" : "inactive";
  };

  const filteredClients = useMemo(() => {
    let result = [...clients];

    if (activeFilter !== "all") {
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
      active: clients.filter((c) => c.active).length,
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
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search clients..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="bg-muted p-1 rounded-lg inline-flex">
              <button
                onClick={() => setActiveFilter("all")}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  activeFilter === "all"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({statusCounts.all})
              </button>
              <button
                onClick={() => setActiveFilter("active")}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  activeFilter === "active"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Active ({statusCounts.active})
              </button>
              <button
                onClick={() => setActiveFilter("inactive")}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  activeFilter === "inactive"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Inactive ({statusCounts.inactive})
              </button>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Loading clients...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-lg font-semibold text-foreground">Failed to load clients</p>
                <p className="text-sm text-muted-foreground">Please try again</p>
              </div>
              <Button onClick={() => mutate()}>Try Again</Button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredClients.length === 0 && (
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {searchQuery || activeFilter !== "all"
                  ? "No clients found"
                  : "No clients yet"}
              </h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                {searchQuery || activeFilter !== "all"
                  ? "Try adjusting your search or filters"
                  : "Get started by adding your first client to manage their training and nutrition."}
              </p>
              {!searchQuery && activeFilter === "all" && (
                <AddClientDialog
                  onClientAdded={() => mutate()}
                  trigger={
                    <Button>
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
                  className="flex items-center gap-4 p-4 bg-card rounded-lg border border-border hover:border-primary/30 transition-colors cursor-pointer group"
                >
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-primary">{initials}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-foreground">{client.name}</h4>
                      {isOverdue && (
                        <Badge variant="destructive" className="text-xs">
                          <Clock className="w-3 h-3" />
                          {daysOverdue}d overdue
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      Last check-in: {formatLastCheckIn(client.lastCheckInDate)}
                    </p>
                  </div>

                  {/* Status Badge */}
                  <Badge variant={status === "active" ? "success" : "secondary"}>
                    {status === "active" ? "Active" : "Inactive"}
                  </Badge>

                  {/* Arrow */}
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
