"use client"

import { ClientActivationBanner } from "@/components/clients/client-activation-banner"
import { OverviewContextBar } from "@/components/clients/overview/overview-context-bar"
import { ClientScheduleCard } from "@/components/clients/overview/client-schedule-card"
import { ClientStatusCard } from "@/components/clients/overview/client-status-card"
import { DailyWellnessStrip } from "@/components/clients/daily-pulse/daily-wellness-strip"
import { OverviewEmptySection } from "@/components/clients/overview/overview-empty-section"
import { BarChart3, ImageIcon, ClipboardList } from "lucide-react"
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
  return (
    <div className="space-y-6">
      {/* Activation Banner */}
      {client.onboardingStatus === "setup_in_progress" && (
        <ClientActivationBanner
          client={client}
          onActivated={onClientUpdated}
          onTabChange={onTabChange}
        />
      )}

      {/* Header */}
      <OverviewContextBar clientId={client.id} client={client} />

      {/* Two-card grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_8fr] gap-4 mb-6">
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

      {/* Daily Wellness */}
      <DailyWellnessStrip clientId={client.id} />

      {/* Empty state sections */}
      <OverviewEmptySection
        title="Progress Tracking"
        primaryMessage="No progress tracking data yet"
        secondaryMessage="Progress data will appear here as check-ins are submitted"
        icon={BarChart3}
      />

      <OverviewEmptySection
        title="Progress Photos"
        primaryMessage="No progress photos yet"
        secondaryMessage="Photos will appear here when uploaded through check-ins"
        icon={ImageIcon}
      />

      <OverviewEmptySection
        title="Check-In History"
        primaryMessage="No check-ins submitted yet"
        secondaryMessage="Check-in history will appear here as the client submits weekly check-ins"
        icon={ClipboardList}
      />
    </div>
  )
}
