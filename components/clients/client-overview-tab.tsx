"use client"

import { Loader2 } from "lucide-react"
import { ClientActivationBanner } from "@/components/clients/client-activation-banner"
import { OverviewContextBar } from "@/components/clients/overview/overview-context-bar"
import { ClientScheduleCard } from "@/components/clients/overview/client-schedule-card"
import { ClientStatusCard } from "@/components/clients/overview/client-status-card"
import { DailyWellnessStrip } from "@/components/clients/daily-pulse/daily-wellness-strip"
import { WaitingOnYouSection } from "@/components/clients/overview/waiting-on-you-section"
import { SinceLastVisitSection } from "@/components/clients/overview/since-last-visit-section"
import { useOverviewBrief } from "@/hooks/use-overview-brief"
import type { ClientTab } from "@/lib/client-tabs"
import type { Client, CheckIn } from "@/types/check-in"

interface ClientOverviewTabProps {
  client: Client
  checkIns: CheckIn[]
  isCalculatingBMR: boolean
  onCalculateBMR: () => void
  onSelectCheckIn: (checkIn: CheckIn) => void
  onClientUpdated?: () => void
  onTabChange?: (tab: ClientTab) => void
}

export function ClientOverviewTab({
  client,
  checkIns: _checkIns,
  isCalculatingBMR,
  onCalculateBMR,
  onSelectCheckIn: _onSelectCheckIn,
  onClientUpdated,
  onTabChange,
}: ClientOverviewTabProps) {
  const { brief, isLoading: briefLoading } = useOverviewBrief(client.id)

  return (
    // space-y-4 = the platform section rhythm (16px), which is also what the
    // divider spec requires above the Daily Wellness divider — no page keeps
    // a private rhythm.
    <div className="space-y-4">
      {/* Activation Banner */}
      {client.onboardingStatus === "setup_in_progress" && (
        <ClientActivationBanner
          client={client}
          onActivated={onClientUpdated}
          onTabChange={onTabChange}
        />
      )}

      {/* Pre-session brief: what's waiting + what changed (Session 7.6) */}
      {briefLoading && !brief ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building brief...
        </div>
      ) : (
        brief && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <WaitingOnYouSection
              clientName={client.name}
              unreviewedCheckIn={brief.waitingOnYou.unreviewedCheckIn}
              attentionAlerts={brief.waitingOnYou.attentionAlerts}
              onReviewCheckIns={() => onTabChange?.("check-ins")}
            />
            <SinceLastVisitSection
              lastViewedAt={brief.lastViewedAt}
              deltas={brief.sinceLastVisit}
            />
          </div>
        )
      )}

      {/* Current context: active phase, goal, weeks (reused) */}
      <OverviewContextBar clientId={client.id} client={client} />

      {/* Demoted: quick cards + 28-day wellness strip */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_8fr] gap-4">
        <ClientScheduleCard
          client={client}
          onClientUpdated={onClientUpdated}
        />
        <ClientStatusCard
          client={client}
          isCalculatingBMR={isCalculatingBMR}
          onCalculateBMR={onCalculateBMR}
        />
      </div>

      <DailyWellnessStrip clientId={client.id} />
    </div>
  )
}
