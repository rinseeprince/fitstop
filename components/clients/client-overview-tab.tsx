"use client"

import { useState } from "react"
import { Card, CardBody, CardHeader, CardTitle, CardAction } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckInTimeline } from "@/components/check-in/check-in-timeline"
import { ProgressCharts } from "@/components/check-in/progress-charts"
import { PhotoComparison } from "@/components/check-in/photo-comparison"
import { CheckInScheduleSection } from "@/components/clients/check-in/check-in-schedule-card"
import { ReminderHistoryModal } from "@/components/clients/check-in/reminder-history-modal"
import { Loader2, Calculator, Bell, Edit2 } from "lucide-react"
import { DailyWellnessStrip } from "@/components/clients/daily-pulse/daily-wellness-strip"
import { ClientActivationBanner } from "@/components/clients/client-activation-banner"
import { cn } from "@/lib/utils"
import type { ClientTab } from "@/components/clients/client-page-header"
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
  checkIns,
  isCalculatingBMR,
  onCalculateBMR,
  onSelectCheckIn,
  onClientUpdated,
  onTabChange,
}: ClientOverviewTabProps) {
  const [isEditingSchedule, setIsEditingSchedule] = useState(false)
  const [showReminderHistory, setShowReminderHistory] = useState(false)

  const currentWeight = client.currentWeight || checkIns[0]?.weight
  const currentBf = client.currentBodyFatPercentage || checkIns[0]?.bodyFatPercentage
  const weightUnit = client.weightUnit || "lbs"
  const weightDelta = currentWeight && client.goalWeight
    ? currentWeight - client.goalWeight
    : null
  const bfDelta = currentBf && client.goalBodyFatPercentage
    ? currentBf - client.goalBodyFatPercentage
    : null

  const getFrequencyLabel = () => {
    switch (client.checkInFrequency) {
      case "weekly": return "Weekly"
      case "biweekly": return "Bi-weekly"
      case "monthly": return "Monthly"
      case "custom": return `Every ${client.checkInFrequencyDays} days`
      case "none": return "No schedule"
      default: return "Weekly"
    }
  }

  const getDayLabel = (day: string | null | undefined) => {
    if (!day) return "Any day"
    return day.charAt(0).toUpperCase() + day.slice(1)
  }

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

      {/* Client Info & Metrics */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Card 1: Client & Schedule */}
        <Card>
          <CardHeader>
            <CardTitle>Client & Schedule</CardTitle>
            <CardAction>
              {!isEditingSchedule && (
                <Button variant="ghost" size="sm" onClick={() => setIsEditingSchedule(true)}>
                  <Edit2 className="h-4 w-4" />
                </Button>
              )}
            </CardAction>
          </CardHeader>
          <CardBody>
            {/* Contact info — compact */}
            <p className="text-sm text-muted-foreground">{client.email}</p>

            {isEditingSchedule ? (
              <div className="mt-4">
                <CheckInScheduleSection
                  client={client}
                  onUpdate={() => {
                    setIsEditingSchedule(false)
                    window.location.reload()
                  }}
                  onCancel={() => setIsEditingSchedule(false)}
                />
              </div>
            ) : (
              <>
                {/* Schedule + Adherence — 2x2 grid */}
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Frequency</p>
                    <p className="text-sm font-semibold">{getFrequencyLabel()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Expected Day</p>
                    <p className="text-sm font-semibold">{getDayLabel(client.expectedCheckInDay)}</p>
                  </div>
                  {client.checkInAdherenceRate !== undefined && (
                    <>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Adherence</p>
                        <p className="text-sm font-semibold text-primary">{Math.round(client.checkInAdherenceRate)}%</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Streak</p>
                        <p className="text-sm font-semibold text-primary">{client.currentStreak || 0}</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Reminder status — condensed single line */}
                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                  <Bell className="h-3 w-3" />
                  <span>Reminders {client.reminderPreferences?.enabled ? "on" : "off"}</span>
                  {client.reminderPreferences?.autoSend && (
                    <Badge variant="secondary">Auto</Badge>
                  )}
                  <button
                    onClick={() => setShowReminderHistory(true)}
                    className="ml-auto text-xs text-primary hover:underline"
                  >
                    History
                  </button>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {/* Card 2: Body Metrics (read-only) */}
        <Card>
          <CardHeader>
            <CardTitle>Body Metrics</CardTitle>
            {(!client.bmr || !client.tdee) && client.currentWeight && client.height && client.gender && (
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCalculateBMR}
                  disabled={isCalculatingBMR}
                >
                  {isCalculatingBMR ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Calculating...
                    </>
                  ) : (
                    <>
                      <Calculator className="h-4 w-4 mr-2" />
                      Calculate BMR
                    </>
                  )}
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardBody>
            {/* Composition metrics — 2-col grid */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Current Weight</p>
                <p className="text-2xl font-semibold">
                  {currentWeight ? `${currentWeight.toFixed(1)}` : "Not recorded"}
                  {currentWeight && <span className="text-muted-foreground"> {weightUnit}</span>}
                </p>
                {weightDelta !== null && (
                  <p className={cn("text-xs font-medium mt-0.5", weightDelta > 0 ? "text-warning" : "text-success")}>
                    {Math.abs(weightDelta).toFixed(1)} {weightUnit} to goal
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Goal Weight</p>
                <p className="text-2xl font-semibold">
                  {client.goalWeight ? `${client.goalWeight.toFixed(1)}` : "Not set"}
                  {client.goalWeight && <span className="text-muted-foreground"> {weightUnit}</span>}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Body Fat</p>
                <p className="text-2xl font-semibold">
                  {currentBf ? `${currentBf.toFixed(1)}` : "Not recorded"}
                  {currentBf && <span className="text-muted-foreground"> %</span>}
                </p>
                {bfDelta !== null && (
                  <p className={cn("text-xs font-medium mt-0.5", bfDelta > 0 ? "text-warning" : "text-success")}>
                    {Math.abs(bfDelta).toFixed(1)}% to goal
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Goal Body Fat</p>
                <p className="text-2xl font-semibold">
                  {client.goalBodyFatPercentage ? `${client.goalBodyFatPercentage.toFixed(1)}` : "Not set"}
                  {client.goalBodyFatPercentage && <span className="text-muted-foreground"> %</span>}
                </p>
              </div>
            </div>

            {/* Single divider */}
            <div className="border-b border-border my-4" />

            {/* Derived stats — 2x2 grid */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">BMR</p>
                <p className="text-2xl font-semibold">
                  {client.bmr ? Math.round(client.bmr) : "Not calculated"}
                  {client.bmr && <span className="text-muted-foreground"> cal/day</span>}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">TDEE (Sedentary)</p>
                <p className="text-2xl font-semibold">
                  {client.tdee ? Math.round(client.tdee) : "Not calculated"}
                  {client.tdee && <span className="text-muted-foreground"> cal/day</span>}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Height</p>
                <p className="text-lg font-semibold">
                  {client.height
                    ? `${client.height} ${client.heightUnit || "in"}`
                    : "Not set"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Gender</p>
                <p className="text-lg font-semibold capitalize">
                  {client.gender || "Not set"}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Reminder History Modal */}
      <ReminderHistoryModal
        clientId={client.id}
        clientName={client.name}
        open={showReminderHistory}
        onClose={() => setShowReminderHistory(false)}
      />

      {/* Daily Wellness Strip */}
      <DailyWellnessStrip clientId={client.id} />

      {/* Progress Charts */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Progress Tracking</h3>
        <ProgressCharts checkIns={checkIns} />
      </div>

      {/* Progress Photos */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Progress Photos</h3>
        <PhotoComparison checkIns={checkIns} />
      </div>

      {/* Check-in History */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Check-In History</h3>
        <CheckInTimeline
          checkIns={checkIns}
          onSelectCheckIn={onSelectCheckIn}
        />
      </div>
    </div>
  )
}
