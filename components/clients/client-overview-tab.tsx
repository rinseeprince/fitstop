"use client";

import { useCallback, useMemo, useState } from "react";
import { ClientActivationBanner } from "@/components/clients/client-activation-banner";
import { DeleteNoteDialog } from "@/components/clients/notes/delete-note-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AdherenceCard } from "@/components/clients/overview/adherence-card";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { ClientScheduleCard } from "@/components/clients/overview/client-schedule-card";
import { EditRailActions } from "@/components/clients/overview/inline-edit-fields";
import { useClientProfileEdit } from "@/components/clients/overview/use-client-profile-edit";
import { ClientStatusCard } from "@/components/clients/overview/client-status-card";
import { CoachNotesCard } from "@/components/clients/overview/coach-notes-card";
import { CurrentPlanSection } from "@/components/clients/overview/current-plan-section";
import { SinceLastVisitSection } from "@/components/clients/overview/since-last-visit-section";
import { WaitingOnYouSection } from "@/components/clients/overview/waiting-on-you-section";
import {
  WELLNESS_WINDOW_DAYS,
  WellnessCards,
} from "@/components/clients/overview/wellness-cards";
import { trailingDates } from "@/components/clients/overview/overview-format";
import { ADHERENCE_WINDOW_DAYS, useClientAdherence } from "@/hooks/use-client-adherence";
import { useClientGoals, useInvalidateClientGoals } from "@/hooks/use-client-goals";
import { useClientNotes } from "@/hooks/use-client-notes";
import { useOverviewBrief } from "@/hooks/use-overview-brief";
import { useOverviewPlanSummary } from "@/hooks/use-overview-plan-summary";
import { useWellnessData } from "@/hooks/use-wellness-data";
import { useToast } from "@/hooks/use-toast";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";
import {
  resolveEffectiveGoal,
  toClientGoalInput,
} from "@/lib/goals/resolve-effective-goal";
import type { ClientTab } from "@/lib/client-tabs";
import type { AlertType } from "@/types/attention-feed";
import type { Client } from "@/types/check-in";
import type { ClientNote } from "@/types/coach-overview";

interface ClientOverviewTabProps {
  client: Client;
  onClientUpdated?: () => void;
  /** extraParams address a pane on arrival (the block-ending row sends
   *  `{ journey: "blocks" }`); every plain-tab caller ignores it. */
  onTabChange?: (tab: ClientTab, extraParams?: Record<string, string>) => void;
}

/**
 * The coach's client Overview, read top to bottom as: what needs my attention →
 * what happened → what I said last time → who this client is → what they are on
 * → how consistent they are → how they feel.
 */
export function ClientOverviewTab({
  client,
  onClientUpdated,
  onTabChange,
}: ClientOverviewTabProps) {
  const {
    brief,
    isLoading: briefLoading,
    mutate: mutateBrief,
    markSeen,
    isMarkingSeen,
  } = useOverviewBrief(client.id);
  const { summary, isLoading: summaryLoading } = useOverviewPlanSummary(client.id);
  const { adherence, isLoading: adherenceLoading } = useClientAdherence(client.id);
  const { goal: currentGoals } = useClientGoals(client.id);
  const invalidateGoals = useInvalidateClientGoals();
  const {
    notes,
    isLoading: notesLoading,
    addNote,
    setPinned,
    deleteNote,
  } = useClientNotes(client.id);
  const [notePendingDelete, setNotePendingDelete] = useState<ClientNote | null>(null);
  const { logs: wellnessLogs, isLoading: wellnessLoading } = useWellnessData(client.id, {
    daysBack: WELLNESS_WINDOW_DAYS - 1,
    withHabitLogs: false,
  });

  const wellnessDates = useMemo(() => trailingDates(WELLNESS_WINDOW_DAYS), []);
  const { toast } = useToast();

  // The goal the client is on RIGHT NOW, resolved from `client_goals` through
  // the one shared resolver (invariant 16). The status card used to read the
  // denormalized `clients` mirror directly, which made it the only coach surface
  // rendering a goal nobody had resolved.
  //
  // Client-local today: the goal's start date is on the CLIENT's calendar, and
  // the client record is already in scope, so resolve their zone directly —
  // the same anchor and the same reasoning as comparison-service.ts:72, which
  // feeds this identical resolver. The card consumes only the two targets today;
  // seeding the device day would hand the next consumer the wrong anchor.
  const effectiveGoal = useMemo(
    () =>
      resolveEffectiveGoal({
        clientGoal: toClientGoalInput(currentGoals, client),
        today: getTodayDateStringInTimezone(client.timezone),
      }),
    [currentGoals, client]
  );

  const goToTab = useCallback(
    (tab: ClientTab, extraParams?: Record<string, string>) =>
      onTabChange?.(tab, extraParams),
    [onTabChange]
  );

  // The check-in day lives on the client record but drives the brief's timing
  // strip, so a settings save has to revalidate both.
  const handleClientUpdated = useCallback(() => {
    onClientUpdated?.();
    void mutateBrief();
  }, [onClientUpdated, mutateBrief]);

  // The inline editor writes the goal as well as the profile, so a save has to
  // revalidate BOTH areas: the goals read behind the status card, and the client
  // record everything else is still derived from (a goal write dual-writes the
  // `clients` mirror).
  const handleSaved = useCallback(() => {
    void invalidateGoals(client.id);
    handleClientUpdated();
  }, [invalidateGoals, client.id, handleClientUpdated]);

  const edit = useClientProfileEdit(client, handleSaved, currentGoals);

  const handleMarkSeen = useCallback(() => {
    void markSeen();
  }, [markSeen]);

  // Reuses the dashboard's dismissal store, so clearing an alert here clears it
  // there too. The brief's evaluator already filters dismissed alerts, hence the
  // plain revalidate rather than any local bookkeeping.
  const handleDismissAlert = useCallback(
    (alertType: AlertType) => {
      void (async () => {
        try {
          const res = await fetch("/api/dashboard/attention-feed/dismiss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId: client.id, alertType }),
          });
          const payload = (await res.json()) as { success?: boolean; error?: string };
          if (!res.ok || !payload.success) {
            throw new Error(payload.error || "Failed to dismiss alert");
          }
          await mutateBrief();
        } catch (error) {
          toast({
            title: "Could not dismiss",
            description: error instanceof Error ? error.message : "Something went wrong",
            variant: "destructive",
          });
        }
      })();
    },
    [client.id, mutateBrief, toast]
  );

  const handleTogglePin = useCallback(
    (note: ClientNote) => setPinned(note.id, !note.isPinned),
    [setPinned]
  );

  return (
    // space-y-4 = the platform section rhythm (16px), which is also the gap the
    // divider spec requires above each SectionLabel — no page keeps a private
    // rhythm.
    <div className="space-y-4">
      {client.onboardingStatus === "setup_in_progress" && (
        <ClientActivationBanner
          client={client}
          onActivated={onClientUpdated}
          onTabChange={onTabChange}
        />
      )}

      {/* 1 — Waiting on you + Since your last visit */}
      {briefLoading && !brief ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
          <Skeleton className="h-[196px] rounded-[6px]" />
          <Skeleton className="h-[196px] rounded-[6px]" />
        </div>
      ) : (
        brief && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
            <WaitingOnYouSection
              clientName={client.name}
              unreviewedCheckIn={brief.waitingOnYou.unreviewedCheckIn}
              attentionAlerts={brief.waitingOnYou.attentionAlerts}
              blockEnding={brief.waitingOnYou.blockEnding}
              onTabChange={goToTab}
              onDismissAlert={handleDismissAlert}
            />
            <SinceLastVisitSection
              lastViewedAt={brief.lastViewedAt}
              activity={brief.activity}
              onMarkSeen={handleMarkSeen}
              isMarkingSeen={isMarkingSeen}
            />
          </div>
        )
      )}

      {/* 2 — Coach notes */}
      <CoachNotesCard
        notes={notes}
        isLoading={notesLoading}
        onAddNote={addNote}
        onTogglePin={handleTogglePin}
        onDeleteNote={setNotePendingDelete}
        onOpenNotes={() => goToTab("notes")}
      />

      {/* 3 — Who this client is + where they stand */}
      {/* The edit action rides the section rail on the far right, the platform's
          divider grammar (left = identity, right = meta/actions) — not a pencil
          floating inside one of the two cards. */}
      <div>
        <SectionLabel
          label="Client"
          actions={<EditRailActions edit={edit} />}
        />
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[2fr_3fr]">
        <ClientScheduleCard
          client={client}
          checkInTiming={brief?.checkInTiming ?? null}
          isTimingLoading={briefLoading}
          edit={edit}
        />
        <ClientStatusCard
          client={client}
          goal={effectiveGoal}
          goalStartDate={currentGoals?.goalStartDate ?? null}
          training={summary?.training ?? null}
          upcomingTraining={summary?.upcomingTraining ?? null}
          onOpenMetrics={() => goToTab("metrics")}
          edit={edit}
        />
        </div>
      </div>


      {/* 4 — Current plan */}
      <CurrentPlanSection
        summary={summary}
        isLoading={summaryLoading}
        onTabChange={goToTab}
      />

      {/* 5 — Adherence */}
      <AdherenceCard
        adherence={adherence}
        isLoading={adherenceLoading}
        windowDays={ADHERENCE_WINDOW_DAYS}
        onTabChange={goToTab}
      />

      {/* 6 — Daily wellness */}
      <WellnessCards
        logs={wellnessLogs}
        dates={wellnessDates}
        attentionAlerts={brief?.waitingOnYou.attentionAlerts ?? []}
        isLoading={wellnessLoading}
        onOpenWellness={() => goToTab("wellness")}
      />

      <DeleteNoteDialog
        note={notePendingDelete}
        onOpenChange={(open) => {
          if (!open) setNotePendingDelete(null);
        }}
        onConfirm={deleteNote}
      />
    </div>
  );
}
