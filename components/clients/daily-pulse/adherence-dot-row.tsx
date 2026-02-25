"use client"

import { cn } from "@/lib/utils"
import type { DailyLog, NutritionAdherenceStatus } from "@/types/daily-log"

interface AdherenceDotRowProps {
  logs: DailyLog[]
  type: "nutrition" | "training"
  label: string
  onDotClick?: (dateStr: string) => void
  selectedDate?: string | null
}

const getDotColor = (type: "nutrition" | "training", log: DailyLog | undefined) => {
  if (!log) return "bg-gray-300" // No log for this day
  
  if (type === "nutrition") {
    const status = log.nutritionAdherence
    if (!status || !log.caloriesConsumed) return "bg-gray-300"
    
    switch (status) {
      case "hit":
        return "bg-emerald-500"
      case "partial":
        return "bg-amber-500"
      case "missed":
        return "bg-red-500"
      default:
        return "bg-gray-300"
    }
  } else {
    // Training
    return log.trained ? "bg-emerald-500" : "bg-gray-300"
  }
}

const getTooltipText = (type: "nutrition" | "training", log: DailyLog | undefined, date: string) => {
  if (!log) return `${date}: No data`
  
  if (type === "nutrition") {
    if (!log.caloriesConsumed) return `${date}: No nutrition data`
    const status = log.nutritionAdherence || "unknown"
    const calories = log.caloriesConsumed
    const target = log.targetCalories
    const diff = target ? calories - target : 0
    const diffText = diff > 0 ? `+${diff}` : `${diff}`
    
    return `${date}: ${calories} cal (${diffText}) - ${status}`
  } else {
    // Training
    if (log.trained) {
      const sessionName = log.trainingData?.trainingSessionName || "Session completed"
      return `${date}: ${sessionName}`
    }
    return `${date}: Rest day`
  }
}

const formatDateForDisplay = (dateString: string): string => {
  const date = new Date(dateString + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function AdherenceDotRow({ logs, type, label, onDotClick, selectedDate }: AdherenceDotRowProps) {
  // Create a map of logs by date for quick lookup
  const logsByDate = new Map(logs.map(log => [log.date, log]))
  
  // Generate last 28 days
  const today = new Date()
  const dates: string[] = []
  
  for (let i = 27; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
    dates.push(dateStr)
  }
  
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div className="flex gap-1 flex-wrap">
        {dates.map((date) => {
          const log = logsByDate.get(date)
          const color = getDotColor(type, log)
          const tooltip = getTooltipText(type, log, formatDateForDisplay(date))
          
          return (
            <div
              key={date}
              className="group relative"
              onClick={() => onDotClick && onDotClick(date)}
              style={{ cursor: onDotClick ? 'pointer' : 'default' }}
            >
              <div
                className={cn(
                  "w-2 h-2 rounded-full transition-all hover:scale-150",
                  color,
                  date === selectedDate && "ring-2 ring-blue-500 ring-offset-1 scale-150"
                )}
              />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover border rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                {tooltip}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}