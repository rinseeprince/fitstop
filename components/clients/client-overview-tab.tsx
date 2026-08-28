"use client";

import { useCallback, useMemo, useState } from "react";
import { ClientActivationBanner } from "@/components/clients/client-activation-banner";
import { DeleteNoteDialog } from "@/components/clients/notes/delete-note-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientProfileEdit } from "@/components/clients/overview/use-client-profile-edit";
import { ClientDetailsSheet } from "@/components/clients/details/client-details-sheet";
import { CoachNotesCard } from "@/components/clients/overview/coach-notes-card";
import { CurrentPlanSection } from "@/components/clients/overview/current-plan-section";
import { IdentityRow } from "@/components/clients/overview/identity-row";
import { NeedsAttentionSection } from "@/components/clients/overview/needs-attention-section";
import {
  ProgressionChart,
  type ChartMetric,
} from "@/components/clients/overview/progression-chart";
import { SignalsCard } from "@/components/clients/overview/signals-card";
import { SinceLastVisitSection } from "@/components/clients/overview/since-last-visit-section";
import { StatusBand } from "@/components/clients/overview/status-band";
import { trailingDates } from "@/components/clients/overview/overview-format";
import { SIGNALS_WINDOW_DAYS } from "@/lib/overview/window";
import { useClientAdherence } from "@/hooks/use-client-adherence";
import {
  useInvalidateMeasurementSeries,
  useMeasurementSeries,
} from "@/hooks/use-measurement-series";
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
 * was.
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
  const invalidateSeries = useInvalidateMeasurementSeries();
  const {
    notes,
    isLoading: notesLoading,
    addNote,
    setPinned,
    deleteNote,
  } = useClientNotes(client.id);
  const [notePendingDelete, setNotePendingDelete] = useState<ClientNote | null>(null);

  // The consistency surfaces read a fixed trailing window; the chart above them
  // does not read a window at all. `withHabitLogs` stays off: the per-habit
  // breakdown rides on the adherence read, which already holds these rows (and,
  // unlike a logs-derived grid, keeps a habit with nothing logged).
  const { adherence, isLoading: adherenceLoading } = useClientAdherence(
    client.id,
    SIGNALS_WINDOW_DAYS
  );
  const { logs: wellnessLogs, isLoading: wellnessLoading } = useWellnessData(client.id, {
    daysBack: SIGNALS_WINDOW_DAYS - 1,
    withHabitLogs: false,
  });
  // Which body metric the chart is showing. Local to the page, not a URL param:
  // it is a lens on one card, not a pane, and the client page's param contract
  // is one param per TAB (docs/ARCHITECTURE.md → Client page tab structure).
  const [chartMetric, setChartMetric] = useState<ChartMetric>("weight");
  const { series, isLoading: seriesLoading } = useMeasurementSeries(
    client.id,
    client.startDate
  );

  const wellnessDates = useMemo(() => trailingDates(SIGNALS_WINDOW_DAYS), []);
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

  // A sheet save touches THREE areas, so it has to revalidate all three: the
  // goals read behind the band, the client record everything else derives from
  // (a goal write dual-writes the `clients` mirror), and the chart's series —
  // correcting a recorded start weight routes to `recordClientStart`, which
  // MOVES the metric entries dated on the start date, so the chart's first
  // point changes under a save that never looked like a measurement.
  const handleSaved = useCallback(() => {
    void invalidateGoals(client.id);
    void invalidateSeries(client.id);
    handleClientUpdated();
  }, [invalidateGoals, invalidateSeries, client.id, handleClientUpdated]);

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

      {/* 2 — Where they stand. Unlabelled and unwindowed: the chart is the
          client's whole journey and the four cells beside it are structural
          facts, so there is no period for a rail to name. */}
      <StatusBand
        client={client}
        goal={effectiveGoal}
        chart={
          <ProgressionChart
            series={series}
            isLoading={seriesLoading}
            metric={chartMetric}
            onMetricChange={setChartMetric}
            goal={effectiveGoal}
            startDate={client.startDate ?? null}
            timezone={client.timezone}
          />
        }
        onOpenMetrics={() => goToTab("metrics")}
      />

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
