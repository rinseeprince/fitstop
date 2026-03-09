"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckInTimeline } from "@/components/check-in/check-in-timeline"
import { ProgressCharts } from "@/components/check-in/progress-charts"
import { PhotoComparison } from "@/components/check-in/photo-comparison"
import { CheckInScheduleCard } from "@/components/clients/check-in/check-in-schedule-card"
import { InlineEditableMetric } from "@/components/clients/shared/inline-editable-metric"
import { Phone, Mail, Loader2, Calculator } from "lucide-react"
import { DailyWellnessStrip } from "@/components/clients/daily-pulse/daily-wellness-strip"
import type { Client, CheckIn } from "@/types/check-in"

interface ClientOverviewTabProps {
  client: Client
  checkIns: CheckIn[]
  isCalculatingBMR: boolean
  onCalculateBMR: () => void
  onMetricSave: (field: string, value: number, metricName: string, needsConfirmation: boolean) => Promise<void>
  onResetToAuto: (field: "bmr" | "tdee") => Promise<void>
  onSelectCheckIn: (checkIn: CheckIn) => void
}

export function ClientOverviewTab({
  client,
  checkIns,
  isCalculatingBMR,
  onCalculateBMR,
  onMetricSave,
  onResetToAuto,
  onSelectCheckIn,
}: ClientOverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Contact Info & Metrics */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{client.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p className="font-medium text-muted-foreground">Not provided</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle>Current Metrics</CardTitle>
            {(!client.bmr || !client.tdee) && client.currentWeight && client.height && client.gender && (
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
            )}
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              {/* Weight Row */}
              <div className="flex items-center justify-between">
                <InlineEditableMetric
                  label="Current Weight"
                  value={client.currentWeight || checkIns[0]?.weight}
                  unit={client.weightUnit || "lbs"}
                  placeholder="Not recorded"
                  onSave={(value) => onMetricSave("currentWeight", value, "current weight", true)}
                  min={44}
                  max={550}
                  step={0.1}
                />
                <div className="text-right">
                  <InlineEditableMetric
                    label="Goal Weight"
                    value={client.goalWeight}
                    unit={client.weightUnit || "lbs"}
                    placeholder="Not set"
                    onSave={(value) => onMetricSave("goalWeight", value, "goal weight", false)}
                    min={44}
                    max={550}
                    step={0.1}
                  />
                </div>
              </div>

              {/* Body Fat Row */}
              <div className="flex items-center justify-between pt-3 border-t">
                <InlineEditableMetric
                  label="Current Body Fat %"
                  value={client.currentBodyFatPercentage || checkIns[0]?.bodyFatPercentage}
                  unit="%"
                  placeholder="Not recorded"
                  onSave={(value) => onMetricSave("currentBodyFatPercentage", value, "current body fat", true)}
                  min={3}
                  max={60}
                  step={0.1}
                />
                <div className="text-right">
                  <InlineEditableMetric
                    label="Goal Body Fat %"
                    value={client.goalBodyFatPercentage}
                    unit="%"
                    placeholder="Not set"
                    onSave={(value) => onMetricSave("goalBodyFatPercentage", value, "goal body fat", false)}
                    min={3}
                    max={60}
                    step={0.1}
                  />
                </div>
              </div>

              {/* Progress to Goal */}
              {client.goalWeight && (client.currentWeight || checkIns[0]?.weight) && (
                <div className="flex items-center justify-between pt-3 border-t">
                  <div>
                    <p className="text-sm text-muted-foreground">To Goal Weight</p>
                    <p className={`text-2xl font-bold ${
                      ((client.currentWeight || checkIns[0]?.weight || 0) - client.goalWeight) > 0
                        ? "text-warning"
                        : "text-success"
                    }`}>
                      {Math.abs((client.currentWeight || checkIns[0]?.weight || 0) - client.goalWeight).toFixed(1)} {client.weightUnit || "lbs"}
                    </p>
                  </div>
                  {client.goalBodyFatPercentage && (client.currentBodyFatPercentage || checkIns[0]?.bodyFatPercentage) && (
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">To Goal Body Fat</p>
                      <p className={`text-2xl font-bold ${
                        ((client.currentBodyFatPercentage || checkIns[0]?.bodyFatPercentage || 0) - client.goalBodyFatPercentage) > 0
                          ? "text-warning"
                          : "text-success"
                      }`}>
                        {Math.abs((client.currentBodyFatPercentage || checkIns[0]?.bodyFatPercentage || 0) - client.goalBodyFatPercentage).toFixed(1)}%
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* BMR, TDEE & Physical Stats */}
              <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                <InlineEditableMetric
                  label="BMR (Basal Metabolic Rate)"
                  value={client.bmr}
                  unit="cal/day"
                  placeholder="Not calculated"
                  isManual={client.bmrManualOverride}
                  onSave={(value) => onMetricSave("bmr", value, "BMR", false)}
                  onResetToAuto={() => onResetToAuto("bmr")}
                  min={800}
                  max={5000}
                  step={1}
                  formatDisplay={(v) => Math.round(v).toString()}
                />
                <InlineEditableMetric
                  label="TDEE (Sedentary)"
                  value={client.tdee}
                  unit="cal/day"
                  placeholder="Not calculated"
                  isManual={client.tdeeManualOverride}
                  onSave={(value) => onMetricSave("tdee", value, "TDEE", false)}
                  onResetToAuto={() => onResetToAuto("tdee")}
                  min={1000}
                  max={8000}
                  step={1}
                  formatDisplay={(v) => Math.round(v).toString()}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                <div>
                  <p className="text-sm text-muted-foreground">Height</p>
                  <p className="text-lg font-bold">
                    {client.height
                      ? `${client.height} ${client.heightUnit || "in"}`
                      : "Not set"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Gender</p>
                  <p className="text-lg font-bold capitalize">
                    {client.gender || "Not set"}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily Wellness Strip */}
      <DailyWellnessStrip clientId={client.id} />

      {/* Check-In Schedule */}
      <CheckInScheduleCard client={client} onUpdate={() => window.location.reload()} />

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
