"use client";

import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ClientStatusBadge } from "@/components/client-status-badge";
import { EngagementIndicator } from "@/components/engagement-indicator";
import { AddClientDialog } from "@/components/add-client-dialog";
import { EditClientDialog } from "@/components/edit-client-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Loader2, Trash2, Eye, Send, MessageSquare, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import type { ClientWithCheckInInfo } from "@/services/client-service";
import { SendCheckInDialog } from "@/components/check-in/send-check-in-dialog";

type ClientStatus = "active" | "inactive";

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientWithCheckInInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | ClientStatus>("all");
  const [deleteClientId, setDeleteClientId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const fetchClients = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/clients");

      if (!response.ok) {
        throw new Error("Failed to fetch clients");
      }

      const data = await response.json();
      setClients(data.clients || []);
    } catch (err) {
      console.error("Error fetching clients:", err);
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  // Format last check-in date
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

  // Derive status from active field and last check-in
  const getClientStatus = (client: ClientWithCheckInInfo): ClientStatus => {
    return client.active ? "active" : "inactive";
  };

  // Filter and search clients
  const filteredClients = useMemo(() => {
    let result = [...clients];

    // Apply status filter
    if (activeFilter !== "all") {
      result = result.filter((client) => {
        const status = getClientStatus(client);
        return status === activeFilter;
      });
    }

    // Apply search filter
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

  // Count clients by status
  const statusCounts = useMemo(() => {
    return {
      all: clients.length,
      active: clients.filter((c) => c.active).length,
      inactive: clients.filter((c) => !c.active).length,
    };
  }, [clients]);

  const handleDeleteClient = async () => {
    if (!deleteClientId) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/clients/${deleteClientId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete client");
      }

      toast({
        title: "Client deleted",
        description: "The client has been deactivated successfully.",
      });

      // Refresh client list
      await fetchClients();
    } catch (err) {
      toast({
        title: "Failed to delete client",
        description: err instanceof Error ? err.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteClientId(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Clients</h1>
            <p className="text-muted-foreground mt-1">
              Manage and track your client relationships
            </p>
          </div>
          <AddClientDialog onClientAdded={fetchClients} />
        </div>

        {/* Search and Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search clients by name or email..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant={activeFilter === "all" ? "default" : "outline"}
                  onClick={() => setActiveFilter("all")}
                >
                  All ({statusCounts.all})
                </Button>
                <Button
                  variant={activeFilter === "active" ? "default" : "outline"}
                  onClick={() => setActiveFilter("active")}
                >
                  Active ({statusCounts.active})
                </Button>
                <Button
                  variant={activeFilter === "inactive" ? "default" : "outline"}
                  onClick={() => setActiveFilter("inactive")}
                >
                  Inactive ({statusCounts.inactive})
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading State */}
        {loading && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading clients...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error State */}
        {error && !loading && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <AlertCircle className="w-12 h-12 text-destructive" />
                <div className="text-center space-y-1">
                  <p className="font-medium">Failed to load clients</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
                <Button onClick={fetchClients}>Try Again</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty State */}
        {!loading && !error && filteredClients.length === 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                  <Search className="w-8 h-8 text-muted-foreground" />
                </div>
                <div className="text-center space-y-1">
                  <p className="font-medium">
                    {searchQuery || activeFilter !== "all"
                      ? "No clients found"
                      : "No clients yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {searchQuery || activeFilter !== "all"
                      ? "Try adjusting your search or filters"
                      : "Get started by adding your first client"}
                  </p>
                </div>
                {!searchQuery && activeFilter === "all" && (
                  <AddClientDialog
                    onClientAdded={fetchClients}
                    trigger={<Button>Add Your First Client</Button>}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Client List */}
        {!loading && !error && filteredClients.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Client List ({filteredClients.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Desktop Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-3 text-left text-sm font-medium text-muted-foreground">
                        Name
                      </th>
                      <th className="pb-3 text-left text-sm font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="pb-3 text-left text-sm font-medium text-muted-foreground">
                        Last Check-In
                      </th>
                      <th className="pb-3 text-left text-sm font-medium text-muted-foreground">
                        Engagement
                      </th>
                      <th className="pb-3 text-right text-sm font-medium text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((client) => (
                      <tr key={client.id} className="border-b last:border-0">
                        <td className="py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                              {client.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <div>
                              <span className="font-medium">{client.name}</span>
                              <p className="text-xs text-muted-foreground">
                                {client.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4">
                          <ClientStatusBadge status={getClientStatus(client)} />
                        </td>
                        <td className="py-4 text-sm text-muted-foreground">
                          {formatLastCheckIn(client.lastCheckInDate)}
                        </td>
                        <td className="py-4">
                          <EngagementIndicator level={client.engagement || "low"} />
                        </td>
                        <td className="py-4">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/clients/${client.id}`}>
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Link>
                            </Button>
                            <SendCheckInDialog
                              clientId={client.id}
                              clientName={client.name}
                              clientEmail={client.email}
                              trigger={
                                <Button variant="ghost" size="sm">
                                  <Send className="h-4 w-4 mr-1" />
                                  Check-In
                                </Button>
                              }
                            />
                            <EditClientDialog
                              client={client}
                              onClientUpdated={fetchClients}
                              trigger={
                                <Button variant="ghost" size="sm">
                                  <MessageSquare className="h-4 w-4" />
                                </Button>
                              }
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteClientId(client.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="space-y-4 lg:hidden">
                {filteredClients.map((client) => (
                  <Card key={client.id}>
                    <CardContent className="pt-6">
                      <div className="space-y-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-medium">
                              {client.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <div>
                              <p className="font-medium">{client.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {client.email}
                              </p>
                              <div className="mt-1">
                                <ClientStatusBadge
                                  status={getClientStatus(client)}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            Last check-in:
                          </span>
                          <span>{formatLastCheckIn(client.lastCheckInDate)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            Engagement:
                          </span>
                          <EngagementIndicator level={client.engagement || "low"} />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 bg-transparent"
                            asChild
                          >
                            <Link href={`/clients/${client.id}`}>
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Link>
                          </Button>
                          <SendCheckInDialog
                            clientId={client.id}
                            clientName={client.name}
                            clientEmail={client.email}
                            trigger={
                              <Button variant="outline" size="sm">
                                <Send className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <EditClientDialog
                            client={client}
                            onClientUpdated={fetchClients}
                            trigger={
                              <Button variant="outline" size="sm">
                                <MessageSquare className="h-4 w-4" />
                              </Button>
                            }
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteClientId(client.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteClientId !== null}
        onOpenChange={(open) => !open && setDeleteClientId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Client</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the client. They won&apos;t appear in active
              filters, but their data and check-in history will be preserved. You
              can reactivate them later by editing their profile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteClient}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deactivating...
                </>
              ) : (
                "Deactivate"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
