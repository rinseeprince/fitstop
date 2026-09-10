"use client";

import { useEffect, useState } from "react";
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
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import {
  useClearBlockFacts,
  useClientBlocks,
} from "@/components/clients/metrics/hooks/use-client-blocks";
import { useRoundTripBlockStart } from "@/components/clients/metrics/hooks/use-round-trip-block";
import { swrFetcher } from "@/lib/swr-fetcher";
import { format } from "date-fns";
import {
  formatDateOnlyShort,
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
  /** Name of the preselected client, for the sentence under the date field. */
  clientName?: string;
  onSuccess?: (clientId: string) => void;
};

type ClientOption = {
  id: string;
  name: string;
  timezone?: string;
};

export function ApplyToClientDialog({
  open,
  onOpenChange,
  savedPlan,
  inlinePlan,
  preselectedClientId,
  clientTimezone,
  clientName,
  onSuccess,
}: ApplyToClientDialogProps) {
  const { toast } = useToast();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const invalidateTrainingData = useInvalidateTrainingData();
  const clearBlockFacts = useClearBlockFacts();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();
  const [clientId, setClientId] = useState(preselectedClientId ?? "");
  // The coach's own pick, null until they touch the field. The date the field
  // shows is DERIVED from it below — the pick, else a seed built from the
  // floor and the round-trip block — so the default follows the floor as the
  // payload lands instead of being reset by an effect (the nutrition
  // builder's shape). An emptied field means the seed again.
  const [startDatePick, setStartDatePick] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch clients (only when no preselected client)
  const { data: clientsData } = useSWR<{ clients: ClientOption[] }>(
    !preselectedClientId ? "/api/clients" : null,
    swrFetcher,
    { revalidateOnFocus: false }
  );
  const clients = clientsData?.clients ?? [];

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setClientId(preselectedClientId ?? "");
      setStartDatePick(null);
    }
  }, [open, preselectedClientId]);

  const trainingDays = savedPlan.sessions.filter((s) => !s.isRest).length;
  const restDays = savedPlan.sessions.length - trainingDays;
  const weekCount =
    savedPlan.programDurationWeeks ??
    (savedPlan.sessions.length > 0
      ? Math.max(...savedPlan.sessions.map((s) => s.weekIndex)) + 1
      : 1);

  // Mirror the server guard's anchor (getClientTodayString) until the payload
  // below lands: a real synced client timezone wins; the 'UTC' never-synced
  // sentinel and an unknown timezone fall back to the coach's device (= stored
  // coach tz). The server guard stays the authority.
  const selectedClientTimezone = preselectedClientId
    ? clientTimezone
    : clients.find((c) => c.id === clientId)?.timezone;
  const selectedClientName = preselectedClientId
    ? (clientName ?? null)
    : (clients.find((c) => c.id === clientId)?.name ?? null);
  const deviceToday = getTodayDateString();
  const clientLocalToday =
    selectedClientTimezone && selectedClientTimezone !== "UTC"
      ? getTodayDateStringInTimezone(selectedClientTimezone)
      : null;

  // The earliest day a program may START: the shared deletion floor — the
  // client's today, or tomorrow once they have logged anything today. A server
  // answer (it reads the client's logs), so it rides the blocks payload beside
  // the client's today, the same read the round-trip seed already makes; an
  // empty client id fetches nothing. Until it lands the timezone-derived today
  // stands in, and the server refuses a start before the floor either way.
  const { clientToday: payloadToday, planStartFloor } = useClientBlocks(clientId);
  const startFloor = planStartFloor ?? clientLocalToday ?? deviceToday;
  // Seeded from the block the coach came from, when they came from one: the
  // whole point of "place one" is that they have already said which days they
  // mean. The block id rides the URL under the round-trip contract, and the
  // chain is in SWR's cache because they were just looking at it. A block
  // already under way seeds the floor, not the day it began; with no round
  // trip the floor itself is the seed — a coach placing a program almost
  // always means now.
  const blockStart = useRoundTripBlockStart(preselectedClientId, "apply");
  const seedStartDate = blockStart && blockStart > startFloor ? blockStart : startFloor;
  const startDate = startDatePick ?? seedStartDate;
  // Why today is greyed out, when it is — said only once the payload says so.
  const loggedLine =
    planStartFloor && payloadToday && planStartFloor > payloadToday
      ? { logged: payloadToday, from: planStartFloor }
      : null;

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
        ? { type: "inline" as const, plan: inlinePlan, startDate }
        : { type: "plan" as const, savedPlanId: savedPlan.id, startDate };

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
        // A placement can fail AFTER it has committed — the program is on the
        // calendar and only the earlier program's later sessions survived
        // (PlacementSupersedeError). Refresh both calendar areas so what the
        // coach sees matches the sentence they just read.
        void invalidateNutritionCalendar(clientId);
        void invalidateTrainingData(clientId);
        return;
      }

      toast({
        title: "Plan applied",
        description: `Created ${data.sessionsCreated} sessions and ${data.eventsCreated} events`,
      });

      // The nutrition month view is computed from the sessions placement just
      // laid and is SWR-cached; refresh it here so every host of this dialog
      // is covered once.
      void invalidateNutritionCalendar(clientId);
      // And the Journey block cards, which are DERIVED from the rows this just
      // wrote — the area that owes an invalidator is the one that READS what
      // you wrote, not the one you wrote (CONVENTIONS §7).
      void clearBlockFacts(clientId);
      // And the Overview's cards and rows and the dashboard feed, which are
      // DERIVED from what this wrote — cleared, not revalidated, because they
      // render definite answers (CONVENTIONS §7).
      void clearClientOverview(clientId);
      void clearAttentionFeed();
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

          {/* Start date. `min` is the floor; the server refuses a start before
              it, and the sentence under the field says why today is greyed. */}
          <div className="space-y-1.5">
            <Label htmlFor="start-date">Start Date</Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              min={startFloor}
              onChange={(e) => setStartDatePick(e.target.value || null)}
            />
            {loggedLine && (
              <p className="text-[11px] leading-[1.4] text-[#5a7d82]">
                {selectedClientName ?? "This client"} has already logged{" "}
                {formatDateOnlyShort(loggedLine.logged)}. A plan can start from{" "}
                {formatDateOnlyShort(loggedLine.from)}.
              </p>
            )}
            {clientLocalToday && clientLocalToday !== deviceToday && (
              <p className="text-[10px] text-muted-foreground">
                {selectedClientName ?? "This client"}&apos;s local date is{" "}
                {format(new Date(clientLocalToday + "T00:00:00"), "d MMMM")}.
              </p>
            )}
          </div>

          {/* Program info */}
          <div className="flex items-center gap-2 flex-wrap">
            {savedPlan.splitType && (
              <Badge variant="outline" className="text-xs">
                {savedPlan.splitType.replace(/_/g, " ")}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {weekCount} {weekCount === 1 ? "week" : "weeks"}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {trainingDays} training + {restDays} rest
            </Badge>
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
