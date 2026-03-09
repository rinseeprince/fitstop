"use client"

import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Calendar, Activity, Apple, Brain, FileText, Clock, X } from "lucide-react"
import type { DailyLog } from "@/types/daily-log"

interface DayDetailCardProps {
  log: DailyLog
  habits: Array<{
    habitName: string
    completed: boolean
    value?: number
    targetValue?: number
    targetUnit?: string
    isBoolean: boolean
  }>
  onClose: () => void
}

export function DayDetailCard({ log, habits, onClose }: DayDetailCardProps) {
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString + 'T00:00:00')
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp)
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  const getNutritionColor = (consumed?: number, target?: number) => {
    if (!consumed || !target) return "text-muted-foreground"
    const diff = Math.abs(consumed - target)
    if (diff <= 50) return "text-success"
    if (diff <= 200) return "text-warning"
    return "text-destructive"
  }

  const getMacroColor = (consumed?: number, target?: number) => {
    if (!consumed || !target) return "text-muted-foreground"
    const percentage = (consumed / target) * 100
    if (percentage >= 90 && percentage <= 110) return "text-success"
    if (percentage >= 80 && percentage <= 120) return "text-warning"
    return "text-destructive"
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="absolute inset-0 flex items-center justify-center z-10 p-4 cursor-pointer"
      onClick={onClose}
    >
      <Card className="relative w-full max-w-xl bg-card shadow-md rounded-lg border cursor-auto" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
        >
          <X className="w-4 h-4" />
        </button>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between border-b border-border pb-2 pr-8">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              {formatDate(log.date)}
            </h3>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimestamp(log.updatedAt)}
            </span>
          </div>

          {/* Wellness Section */}
          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Brain className="w-3.5 h-3.5 text-muted-foreground" />
              Wellness
            </h4>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground text-xs">Mood</span>
              <span className="font-medium text-foreground">{log.mood || "—"}/5</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground text-xs">Energy</span>
              <span className="font-medium text-foreground">{log.energy || "—"}/10</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground text-xs">Sleep</span>
              <span className="font-medium text-foreground">{log.sleep || "—"}/10</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground text-xs">Stress</span>
              <span className="font-medium text-foreground">{log.stress || "—"}/10</span>
            </div>
          </div>

          {/* Training Section */}
          <div className="space-y-2 border-t border-border pt-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              Training
            </h4>
            <div className="space-y-1">
              {log.trainingData?.trainingSessionName && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">
                    {log.trainingData.trainingSessionName}
                    {log.trainingData.isAlternativeSession && (
                      <span className="text-xs text-muted-foreground ml-2">(swapped from scheduled)</span>
                    )}
                  </span>
                  <span className={`text-sm font-medium ${log.trainingData.sessionCompleted ? 'text-success' : 'text-destructive'}`}>
                    {log.trainingData.sessionCompleted ? 'Completed' : 'Missed'}
                  </span>
                </div>
              )}

              {/* Planned Activities */}
              {log.trainingData?.activityStatuses && Object.entries(log.trainingData.activityStatuses).map(([id, activity]) => (
                <div key={id} className="flex items-center justify-between pl-4">
                  <span className="text-sm text-foreground">{activity.activityName}</span>
                  <span className={`text-sm ${activity.completed ? 'text-success' : 'text-destructive'}`}>
                    {activity.completed ? 'Completed' : 'Skipped'}
                    {activity.completed && <span className="text-muted-foreground ml-1">({activity.estimatedCalories} cal)</span>}
                  </span>
                </div>
              ))}

              {/* Unplanned Activities */}
              {log.trainingData?.unplannedActivities && log.trainingData.unplannedActivities.map((activity, idx) => (
                <div key={idx} className="flex items-center justify-between pl-4">
                  <span className="text-sm text-foreground italic">{activity.activityName} (unplanned)</span>
                  <span className="text-xs text-muted-foreground">
                    {activity.intensityLevel}, {activity.durationMinutes} min
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Nutrition Section */}
          <div className="space-y-2 border-t border-border pt-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Apple className="w-3.5 h-3.5 text-muted-foreground" />
              Nutrition
            </h4>
            {log.caloriesConsumed ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Calories</span>
                  <span className={`text-sm font-medium ${getNutritionColor(log.caloriesConsumed, log.targetCalories)}`}>
                    {log.caloriesConsumed} cal / {log.targetCalories || "—"} cal
                    {log.calorieSurplusDeficit !== undefined && log.calorieSurplusDeficit !== 0 && (
                      <span className="ml-1">
                        ({log.calorieSurplusDeficit > 0 ? '+' : ''}{log.calorieSurplusDeficit})
                      </span>
                    )}
                  </span>
                </div>
                {(log.proteinG || log.carbsG || log.fatG) && (
                  <div className="space-y-1 pl-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Protein</span>
                      <span className={`text-xs ${getMacroColor(log.proteinG, log.targetProteinG)}`}>
                        {log.proteinG}g / {log.targetProteinG || "—"}g
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Carbs</span>
                      <span className={`text-xs ${getMacroColor(log.carbsG, log.targetCarbsG)}`}>
                        {log.carbsG}g / {log.targetCarbsG || "—"}g
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Fat</span>
                      <span className={`text-xs ${getMacroColor(log.fatG, log.targetFatG)}`}>
                        {log.fatG}g / {log.targetFatG || "—"}g
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No nutrition data logged</p>
            )}
          </div>

          {/* Habits Section */}
          {habits.length > 0 && (
            <div className="space-y-2 border-t border-border pt-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Habits</h4>
              <div className="space-y-1">
                {habits.map((habit, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{habit.habitName}</span>
                    <span className={`text-sm font-medium ${habit.completed ? 'text-success' : 'text-destructive'}`}>
                      {habit.completed === true 
                        ? 'Completed' 
                        : habit.completed === false 
                          ? 'Not completed' 
                          : 'Not logged'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes Section */}
          {log.notes && (
            <div className="space-y-2 border-t border-border pt-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                Notes
              </h4>
              <p className="text-sm text-muted-foreground">{log.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}