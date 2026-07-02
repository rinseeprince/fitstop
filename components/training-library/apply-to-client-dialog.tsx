"use client";

import { useState, useEffect } from "react";
import { Loader2, Calendar } from "lucide-react";
import useSWR from "swr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { swrFetcher } from "@/lib/swr-fetcher";
import { format } from "date-fns";
import {
  getDateString,
  getTodayDateString,
  getTodayDateStringInTimezone,
} from "@/lib/date-helpers";
import type { SavedPlan } from "@/types/training";
import type { InlinePlanBody } from "@/lib/validations/training";

type ApplyToClientDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedPlan: SavedPlan;
  /**
   * When set, apply this edited working copy inline (materialized onto the
   * client's calendar; the library template is never touched) instead of
   * placing the saved plan by id. Provided by the client-drawer editor when the
   * coach has unsaved edits.
   */
  inlinePlan?: InlinePlanBody | null;
  preselectedClientId?: string;
  /** Timezone of the preselected client (the client list isn't fetched in that path). */
  clientTimezone?: string;
  onSuccess?: (clientId: string) => void;
};

type ClientOption = {
  id: string;
  name: string;
  timezone?: string;
};

type PhaseOption = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
};

function getNextMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return getDateString(d);
}

export function ApplyToClientDialog({
  open,
  onOpenChange,
  savedPlan,
  inlinePlan,
  preselectedClientId,
  clientTimezone,
  onSuccess,
}: ApplyToClientDialogProps) {
  const { toast } = useToast();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const [clientId, setClientId] = useState(preselectedClientId ?? "");
  const [startDate, setStartDate] = useState(getNextMonday());
  const [phaseId, setPhaseId] = useState<string>("");
  const [repeatCycles, setRepeatCycles] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch clients (only when no preselected client)
  const { data: clientsData } = useSWR<{ clients: ClientOption[] }>(
    !preselectedClientId ? "/api/clients" : null,
    swrFetcher,
    { revalidateOnFocus: false }
  );
  const clients = clientsData?.clients ?? [];

  // Fetch roadmap phases for selected client
  const { data: roadmapData } = useSWR<{ phases?: PhaseOption[] }>(
    clientId ? `/api/clients/${clientId}/roadmap` : null,
    swrFetcher,
    { revalidateOnFocus: false }
  );
  const phases = (roadmapData?.phases ?? []).filter(
    (p) => p.status === "planned" || p.status === "active"
  );

  // Reset phase when client changes
  useEffect(() => {
    setPhaseId("");
  }, [clientId]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setClientId(preselectedClientId ?? "");
      setStartDate(getNextMonday());
      setPhaseId("");
      setRepeatCycles("");
    }
  }, [open, preselectedClientId]);

  const cycleLength =
    savedPlan.cycleLength ?? savedPlan.sessions.filter((s) => !s.isRest).length;
  const trainingDays = savedPlan.sessions.filter((s) => !s.isRest).length;
  const restDays = cycleLength - trainingDays;

  // Mirror the server guard's anchor (getClientTodayString): a real synced
  // client timezone wins; the 'UTC' never-synced sentinel falls back to the
  // coach's device (= stored coach tz). Unknown timezone → no min, the server
  // guard backstops.
  const selectedClientTimezone = preselectedClientId
    ? clientTimezone
    : clients.find((c) => c.id === clientId)?.timezone;
  const selectedClientName = preselectedClientId
    ? null
    : (clients.find((c) => c.id === clientId)?.name ?? null);
  const deviceToday = getTodayDateString();
  const clientLocalToday =
    selectedClientTimezone && selectedClientTimezone !== "UTC"
      ? getTodayDateStringInTimezone(selectedClientTimezone)
      : null;
  const minStartDate =
    clientLocalToday ?? (selectedClientTimezone ? deviceToday : undefined);

  const handleSubmit = async () => {
    if (!clientId) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const url = `/api/clients/${clientId}/training/place-from-library`;
      // Edited working copy -> place inline (template untouched). Otherwise
      // place the saved plan by id (pristine, ownership-checked server-side).
      const body = inlinePlan
        ? {
            type: "inline" as const,
            plan: inlinePlan,
            startDate,
            ...(phaseId && { phaseId }),
            ...(repeatCycles && { repeatCycles: parseInt(repeatCycles, 10) }),
          }
        : {
            type: "plan" as const,
            savedPlanId: savedPlan.id,
            startDate,
            ...(phaseId && { phaseId }),
            ...(repeatCycles && { repeatCycles: parseInt(repeatCycles, 10) }),
          };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "Failed to apply plan",
          description: data.error || "Something went wrong",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Plan applied",
        description: `Created ${data.sessionsCreated} sessions and ${data.eventsCreated} events`,
      });

      // Placement cascade-rewrites nutrition_events; refresh the nutrition
      // calendar cache here so every host of this dialog is covered once.
      void invalidateNutritionCalendar(clientId);
      onOpenChange(false);
      onSuccess?.(clientId);
    } catch {
      toast({
        title: "Error",
        description: "Failed to apply plan to client",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Apply to Client
          </DialogTitle>
          <DialogDescription>
            Place &ldquo;{savedPlan.name}&rdquo; onto a client&apos;s training calendar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Client selector (only when no preselected client) */}
          {!preselectedClientId && (
            <div className="space-y-1.5">
              <Label htmlFor="client">Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="client">
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Start date */}
          <div className="space-y-1.5">
            <Label htmlFor="start-date">Start Date</Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              min={minStartDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            {clientLocalToday && clientLocalToday !== deviceToday && (
              <p className="text-[10px] text-muted-foreground">
                {selectedClientName ?? "This client"}&apos;s local date is{" "}
                {format(new Date(clientLocalToday + "T00:00:00"), "d MMMM")}.
              </p>
            )}
          </div>

          {/* Cycle info */}
          <div className="flex items-center gap-2 flex-wrap">
            {savedPlan.splitType && (
              <Badge variant="outline" className="text-xs">
                {savedPlan.splitType.replace(/_/g, " ")}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {cycleLength}-day cycle
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {trainingDays} training + {restDays} rest
            </Badge>
          </div>

          {/* Phase selector (only if client has phases) */}
          {phases.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="phase">Phase (optional)</Label>
              <Select value={phaseId} onValueChange={setPhaseId}>
                <SelectTrigger id="phase">
                  <SelectValue placeholder="No phase selected" />
                </SelectTrigger>
                <SelectContent>
                  {phases.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.status === "active" && " (active)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Repeat cycles override */}
          <div className="space-y-1.5">
            <Label htmlFor="repeat-cycles">Repeat Cycles (optional)</Label>
            <Input
              id="repeat-cycles"
              type="number"
              min={1}
              max={52}
              value={repeatCycles}
              onChange={(e) => setRepeatCycles(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Number of times to repeat the {cycleLength}-day cycle
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isSubmitting || !clientId}>
            {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Apply Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
