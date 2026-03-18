"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Search, Users, UserCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { ContentItem } from "@/types/content";

interface Client {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

interface AssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  content: ContentItem;
  onSuccess?: () => void;
}

export function AssignmentDialog({
  open,
  onOpenChange,
  content,
  onSuccess,
}: AssignmentDialogProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [assignedClientIds, setAssignedClientIds] = useState<string[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchClientsAndAssignments();
    }
  }, [open, content.id]);

  const fetchClientsAndAssignments = async () => {
    try {
      setLoading(true);
      setError("");

      // Fetch clients and current assignments in parallel
      const [clientsResponse, assignmentsResponse] = await Promise.all([
        fetch("/api/clients", {
          headers: {
            "Content-Type": "application/json"
          }
        }),
        fetch(`/api/content/assignments/${content.id}`, {
          headers: {
            "Content-Type": "application/json"
          }
        }),
      ]);

      if (clientsResponse.ok) {
        const clientsData = await clientsResponse.json();
        setClients(clientsData.clients || []);
      } else {
        const errorData = await clientsResponse.json().catch(() => ({}));
        console.error("Failed to fetch clients:", errorData);
        throw new Error(errorData.error || "Failed to load clients");
      }

      if (assignmentsResponse.ok) {
        const assignmentsData = await assignmentsResponse.json();
        const currentAssignments = assignmentsData.data || [];
        const assignedIds = currentAssignments.map((a: any) => a.clientId);
        setAssignedClientIds(assignedIds);
        setSelectedClientIds(assignedIds);
      } else {
        const errorData = await assignmentsResponse.json().catch(() => ({}));
        console.error("Failed to fetch assignments:", errorData);
        // Don't throw here since assignments are optional
        setAssignedClientIds([]);
        setSelectedClientIds([]);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load clients and assignments");
      console.error("Error fetching clients and assignments:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredClients = clients.filter((client) =>
    client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleClientToggle = (clientId: string, checked: boolean) => {
    setSelectedClientIds((prev) =>
      checked
        ? [...prev, clientId]
        : prev.filter((id) => id !== clientId)
    );
  };

  const handleSelectAll = () => {
    setSelectedClientIds(filteredClients.map(client => client.id));
  };

  const handleSelectNone = () => {
    setSelectedClientIds([]);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");

    // Determine what assignments to add and remove
    const toAssign = selectedClientIds.filter(id => !assignedClientIds.includes(id));
    const toUnassign = assignedClientIds.filter(id => !selectedClientIds.includes(id));

    try {

      // Process assignments
      const promises = [];

      // Add new assignments
      for (const clientId of toAssign) {
        promises.push(
          fetch("/api/content/assignments", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contentId: content.id,
              clientId,
            }),
          })
        );
      }

      // Remove assignments
      for (const clientId of toUnassign) {
        promises.push(
          fetch(`/api/content/assignments/${content.id}/${clientId}`, {
            method: "DELETE",
            headers: { 
              "Content-Type": "application/json"
            }
          })
        );
      }

      const results = await Promise.all(promises);
      
      // Check if any assignments failed
      const failedResponses = results.filter(response => !response.ok);
      if (failedResponses.length > 0) {
        const errorMessages = await Promise.all(
          failedResponses.map(async (response) => {
            try {
              const errorData = await response.json();
              return errorData.error || "Unknown error";
            } catch {
              return `HTTP ${response.status}`;
            }
          })
        );
        throw new Error(`Some assignments failed: ${errorMessages.join(", ")}`);
      }

      toast({
        title: "Assignments updated",
        description: `Successfully updated assignments for "${content.title}"`,
      });
      
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to update assignments";
      setError(errorMessage);
      
      toast({
        title: "Assignment failed",
        description: errorMessage,
        variant: "destructive",
      });
      
      console.error("Error updating assignments:", {
        error,
        contentId: content.id,
        toAssign,
        toUnassign,
        timestamp: new Date().toISOString()
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getClientInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const changesCount = 
    selectedClientIds.filter(id => !assignedClientIds.includes(id)).length +
    assignedClientIds.filter(id => !selectedClientIds.includes(id)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Assign Content
          </DialogTitle>
          <DialogDescription>
            Choose which clients should have access to "{content.title}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search clients..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Bulk Actions */}
          {!loading && filteredClients.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                  Select All
                </Button>
                <Button variant="ghost" size="sm" onClick={handleSelectNone}>
                  Select None
                </Button>
              </div>
              <span className="text-muted-foreground">
                {selectedClientIds.length} of {filteredClients.length} selected
              </span>
            </div>
          )}

          {/* Client List */}
          <ScrollArea className="h-64">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-sm text-muted-foreground">Loading clients...</div>
              </div>
            ) : filteredClients.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-sm text-muted-foreground">
                  {searchQuery ? "No clients match your search" : "No clients found"}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredClients.map((client) => {
                  const isSelected = selectedClientIds.includes(client.id);
                  const wasAssigned = assignedClientIds.includes(client.id);
                  
                  return (
                    <div
                      key={client.id}
                      className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => 
                          handleClientToggle(client.id, checked as boolean)
                        }
                      />
                      
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {client.avatarUrl ? (
                          <img
                            src={client.avatarUrl}
                            alt={client.name}
                            className="h-8 w-8 rounded-full"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                            {getClientInitials(client.name)}
                          </div>
                        )}
                        
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{client.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {client.email}
                          </p>
                        </div>

                        {wasAssigned && (
                          <Badge variant="outline" className="text-xs">
                            <UserCheck className="h-3 w-3 mr-1" />
                            Assigned
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-muted-foreground">
              {changesCount > 0 && (
                <span>{changesCount} change{changesCount !== 1 ? "s" : ""} pending</span>
              )}
            </div>
            
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit} 
                disabled={submitting || loading}
              >
                {submitting ? "Updating..." : "Update Assignments"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}