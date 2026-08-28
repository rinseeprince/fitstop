"use client";

import { useCallback, useMemo, useState } from "react";
import { ClientActivationBanner } from "@/components/clients/client-activation-banner";
import { DeleteNoteDialog } from "@/components/clients/notes/delete-note-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { useClientProfileEdit } from "@/components/clients/overview/use-client-profile-edit";
import { ClientDetailsSheet } from "@/components/clients/details/client-details-sheet";
import { CoachNotesCard } from "@/components/clients/overview/coach-notes-card";
import { CurrentPlanSection } from "@/components/clients/overview/current-plan-section";
import { IdentityRow } from "@/components/clients/overview/identity-row";
import { NeedsAttentionSection } from "@/components/clients/overview/needs-attention-section";
import { SignalsCard } from "@/components/clients/overview/signals-card";
import { SinceLastVisitSection } from "@/components/clients/overview/since-last-visit-section";
import { StatusBand } from "@/components/clients/overview/status-band";
import { WindowControl } from "@/components/clients/overview/window-control";
import { trailingDates } from "@/components/clients/overview/overview-format";
import {
  DEFAULT_OVERVIEW_WINDOW,
  type OverviewWindow,
} from "@/lib/overview/window";
import { useClientAdherence } from "@/hooks/use-client-adherence";
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
 * The coach's client Overview, read top to bottom as: who this client is →
 * where they stand → what needs doing → what happened since I last looked →
 * how consistent they have been → what they are on → what I said.
 *
 * Identity leads because everything under it is a fact ABOUT that client, and
 * the page previously opened on a work queue that said nothing about whose it
 * was. The window control sits on the Progression rail and governs the period
 * surfaces only — see the note on `windowDays` below.
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
  // The page's one window. It governs the period surfaces — the Signals card
  // and (once it lands) the progression chart — and deliberately NOT the
  // structural facts around them: goal targets, the energy pair, the deadline,
  // the plan's week, the next check-in. Those describe a client, not a period.
  const [windowDays, setWindowDays] = useState<OverviewWindow>(DEFAULT_OVERVIEW_WINDOW);

  // Both period reads take the selected window, so the Signals rows and their
  // expanded panels describe the same days. `withHabitLogs` stays off: the
  // per-habit breakdown rides on the adherence read, which already holds these
  // rows (and, unlike a logs-derived grid, keeps a habit with nothing logged).
  const { adherence, isLoading: adherenceLoading } = useClientAdherence(
    client.id,
    windowDays
  );
  const { logs: wellnessLogs, isLoading: wellnessLoading } = useWellnessData(client.id, {
    daysBack: windowDays - 1,
    withHabitLogs: false,
  });

  const wellnessDates = useMemo(() => trailingDates(windowDays), [windowDays]);
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

  // The activation card's Client-profile row opens the same sheet as the rail's
  // pencil. It used to also scroll the page, because the editor it opened was
  // the section below and could be off screen — an overlay needs no such help.
  const openProfileEditor = edit.start;

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
          planSummary={summary}
          planSummaryLoading={summaryLoading}
          onActivated={onClientUpdated}
          onTabChange={onTabChange}
          onOpenProfile={openProfileEditor}
        />
      )}

      {/* 1 — Who this client is */}
      <IdentityRow
        client={client}
        checkInTiming={brief?.checkInTiming ?? null}
        isTimingLoading={briefLoading}
        onOpenDetails={edit.start}
      />

      {/* 2 — Where they stand. The rail carries the page's window control; the
          band's own cells are structural and stay outside it (status-band.tsx). */}
      <div>
        <SectionLabel
          label="Progression"
          actions={<WindowControl value={windowDays} onChange={setWindowDays} />}
        />
        <StatusBand
          client={client}
          goal={effectiveGoal}
          onOpenMetrics={() => goToTab("metrics")}
        />
      </div>

      {/* 3 — What needs doing + what happened. Two self-railed columns: the
          left one is a work queue, the right one is anchored to last_viewed_at
          rather than to the window, so each states its own scope. */}
      {briefLoading && !brief ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[196px] rounded-[6px]" />
          <Skeleton className="h-[196px] rounded-[6px]" />
        </div>
      ) : (
        brief && (
          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
            <NeedsAttentionSection
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

      {/* 4 — How consistent they are, over the window selected above. */}
      <SignalsCard
        adherence={adherence}
        isAdherenceLoading={adherenceLoading}
        wellnessLogs={wellnessLogs}
        isWellnessLoading={wellnessLoading}
        dates={wellnessDates}
        attentionAlerts={brief?.waitingOnYou.attentionAlerts ?? []}
        windowDays={windowDays}
        onTabChange={goToTab}
      />

      {/* 5 — Current plan */}
      <CurrentPlanSection
        summary={summary}
        isLoading={summaryLoading}
        onTabChange={goToTab}
      />

      {/* 6 — Coach notes */}
      <CoachNotesCard
        notes={notes}
        isLoading={notesLoading}
        onAddNote={addNote}
        onTogglePin={handleTogglePin}
        onDeleteNote={setNotePendingDelete}
        onOpenNotes={() => goToTab("notes")}
      />

      {/* The details sheet. Mounted at the tab, not inside a card, because it
          is opened from three places: the rail pencil, the schedule card's
          "Set a schedule", and the activation banner's Client-profile row. */}
      <ClientDetailsSheet
        client={client}
        checkInTiming={brief?.checkInTiming ?? null}
        edit={edit}
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
