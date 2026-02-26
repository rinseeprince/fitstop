"use client"

import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Calendar, Activity, Apple, Brain, FileText, Clock } from "lucide-react"
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
}

export function DayDetailCard({ log, habits }: DayDetailCardProps) {
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
    if (diff <= 50) return "text-emerald-600"
    if (diff <= 200) return "text-amber-600"
    return "text-red-600"
  }

  const getMacroColor = (consumed?: number, target?: number) => {
    if (!consumed || !target) return "text-muted-foreground"
    const percentage = (consumed / target) * 100
    if (percentage >= 90 && percentage <= 110) return "text-emerald-600"
    if (percentage >= 80 && percentage <= 120) return "text-amber-600"
    return "text-red-600"
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      <Card className="mt-4">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center justify-between border-b pb-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              {formatDate(log.date)}
            </h3>
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="w-4 h-4" />
              Logged: {formatTimestamp(log.updatedAt)}
            </span>
          </div>

          {/* Wellness Section */}
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm text-muted-foreground">
              <Brain className="w-4 h-4" />
              Wellness
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Mood</p>
                <p className="text-2xl font-bold">{log.mood || "—"}/5</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Energy</p>
                <p className="text-2xl font-bold">{log.energy || "—"}/10</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sleep</p>
                <p className="text-2xl font-bold">{log.sleep || "—"}/10</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Stress</p>
                <p className="text-2xl font-bold">{log.stress || "—"}/10</p>
              </div>
            </div>
          </div>

          {/* Training Section */}
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="w-4 h-4" />
              Training
            </h4>
            <div className="space-y-2">
              {log.trainingData?.trainingSessionName && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    {log.trainingData.trainingSessionName}
                    {log.trainingData.isAlternativeSession && (
                      <span className="text-xs text-muted-foreground ml-2">(swapped from scheduled)</span>
                    )}
                  </span>
                  <span className={`text-sm font-medium ${log.trainingData.sessionCompleted ? 'text-emerald-600' : 'text-red-600'}`}>
                    {log.trainingData.sessionCompleted ? 'Completed' : 'Missed'}
                  </span>
                </div>
              )}
              
              {/* Planned Activities */}
              {log.trainingData?.activityStatuses && Object.entries(log.trainingData.activityStatuses).map(([id, activity]) => (
                <div key={id} className="flex items-center justify-between pl-4">
                  <span className="text-sm">{activity.activityName}</span>
                  <span className={`text-sm ${activity.completed ? 'text-emerald-600' : 'text-gray-500'}`}>
                    {activity.completed ? 'Completed' : 'Skipped'}
                    {activity.completed && <span className="text-muted-foreground ml-1">({activity.estimatedCalories} cal)</span>}
                  </span>
                </div>
              ))}
              
              {/* Unplanned Activities */}
              {log.trainingData?.unplannedActivities && log.trainingData.unplannedActivities.map((activity, idx) => (
                <div key={idx} className="flex items-center justify-between pl-4">
                  <span className="text-sm italic">{activity.activityName} (unplanned)</span>
                  <span className="text-sm text-muted-foreground">
                    {activity.intensityLevel}, {activity.durationMinutes} min
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Nutrition Section */}
          <div className="space-y-3">
            <h4 className="font-medium flex items-center gap-2 text-sm text-muted-foreground">
              <Apple className="w-4 h-4" />
              Nutrition
            </h4>
            {log.caloriesConsumed ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Calories</span>
                  <span className={`text-sm font-medium ${getNutritionColor(log.caloriesConsumed, log.targetCalories)}`}>
                    {log.caloriesConsumed} cal / Target {log.targetCalories || "—"} cal
                    {log.calorieSurplusDeficit !== undefined && log.calorieSurplusDeficit !== 0 && (
                      <span className="ml-1">
                        ({log.calorieSurplusDeficit > 0 ? '+' : ''}{log.calorieSurplusDeficit})
                      </span>
                    )}
                  </span>
                </div>
                {(log.proteinG || log.carbsG || log.fatG) && (
                  <div className="grid grid-cols-3 gap-4 pl-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Protein</p>
                      <p className={`text-sm font-medium ${getMacroColor(log.proteinG, log.targetProteinG)}`}>
                        {log.proteinG}g/{log.targetProteinG || "—"}g
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Carbs</p>
                      <p className={`text-sm font-medium ${getMacroColor(log.carbsG, log.targetCarbsG)}`}>
                        {log.carbsG}g/{log.targetCarbsG || "—"}g
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Fat</p>
                      <p className={`text-sm font-medium ${getMacroColor(log.fatG, log.targetFatG)}`}>
                        {log.fatG}g/{log.targetFatG || "—"}g
                      </p>
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
            <div className="space-y-3">
              <h4 className="font-medium text-sm text-muted-foreground">Habits</h4>
              <div className="space-y-1">
                {habits.map((habit, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-sm">{habit.habitName}</span>
                    <span className={`text-sm font-medium ${habit.completed ? 'text-emerald-600' : 'text-gray-500'}`}>
                      {habit.isBoolean ? (
                        habit.completed ? 'Done' : 'Missed'
                      ) : (
                        habit.value !== undefined ? `${habit.value}${habit.targetUnit ? ' ' + habit.targetUnit : ''}` : 'Not logged'
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes Section */}
          {log.notes && (
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="w-4 h-4" />
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