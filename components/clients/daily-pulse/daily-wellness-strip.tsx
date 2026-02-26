"use client"

import { useState, useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { WellnessBarChart } from "./wellness-bar-chart"
import { AdherenceDotRow } from "./adherence-dot-row"
import { DayDetailCard } from "./day-detail-card"
import { getDateDaysAgo } from "@/lib/date-helpers"
import type { DailyLog } from "@/types/daily-log"

interface DailyWellnessStripProps {
  clientId: string
}

export function DailyWellnessStrip({ clientId }: DailyWellnessStripProps) {
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [allHabitLogs, setAllHabitLogs] = useState<any[]>([])
  
  // Fetch daily logs and habit logs
  useEffect(() => {
    const fetchData = async () => {
      try {
        const startDate = getDateDaysAgo(28)
        const endDate = new Date().toISOString().split('T')[0]
        
        // Fetch both daily logs and habit logs in parallel
        const [dailyLogsResponse, habitLogsResponse] = await Promise.all([
          fetch(
            `/api/clients/${clientId}/daily-logs?startDate=${startDate}&endDate=${endDate}`,
            { cache: 'no-store' }
          ),
          fetch(
            `/api/clients/${clientId}/habits/logs?startDate=${startDate}&endDate=${endDate}`,
            { cache: 'no-store' }
          )
        ])
        
        if (!dailyLogsResponse.ok) {
          console.error('Failed to fetch daily logs')
        } else {
          const dailyData = await dailyLogsResponse.json()
          setLogs(dailyData.data || [])
        }
        
        if (!habitLogsResponse.ok) {
          console.error('Failed to fetch habit logs')
        } else {
          const habitData = await habitLogsResponse.json()
          setAllHabitLogs(habitData.data || [])
        }
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setIsLoading(false)
      }
    }
    
    fetchData()
  }, [clientId])
  
  // Conditional returns must come after all hooks
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">Loading wellness data...</p>
        </CardContent>
      </Card>
    )
  }
  
  if (logs.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">No daily check-in data yet</p>
        </CardContent>
      </Card>
    )
  }
  
  // Handle date clicks
  const handleDateClick = (dateStr: string) => {
    if (selectedDate === dateStr) {
      setSelectedDate(null) // Collapse if clicking the same date
    } else {
      setSelectedDate(dateStr)
    }
  }
  
  // Prepare data for charts
  const prepareChartData = (metric: "mood" | "energy" | "sleep" | "stress") => {
    const today = new Date()
    const data = []
    
    for (let i = 27; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      const log = logs.find(l => l.date === dateStr)
      
      data.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dateStr: dateStr,
        value: log ? log[metric] ?? null : null
      })
    }
    
    return data
  }
  
  // Get current values (most recent log)
  const sortedLogs = [...logs].sort((a, b) => b.date.localeCompare(a.date))
  const mostRecentLog = sortedLogs[0]
  
  const currentValues = {
    mood: mostRecentLog?.mood,
    energy: mostRecentLog?.energy,
    sleep: mostRecentLog?.sleep,
    stress: mostRecentLog?.stress
  }
  
  // Get the selected log and habit data
  const selectedLog = selectedDate ? logs.find(l => l.date === selectedDate) : null
  const selectedHabits = selectedDate 
    ? allHabitLogs
        .filter(log => log.date === selectedDate)
        .map(log => ({
          habitName: log.habitName,
          completed: log.completed,
          value: log.value,
          targetValue: log.targetValue,
          targetUnit: log.targetUnit,
          isBoolean: log.isBoolean
        }))
    : []
  
  return (
    <Card className="relative">
      <CardHeader>
        <CardTitle>Daily Wellness</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
          {/* Wellness Charts Grid */}
          <div className="grid gap-4 md:grid-cols-2">
            <WellnessBarChart
              metric="mood"
              data={prepareChartData("mood")}
              currentValue={currentValues.mood}
              label="Mood (1-5)"
              onBarClick={handleDateClick}
              selectedDate={selectedDate}
            />
            <WellnessBarChart
              metric="energy"
              data={prepareChartData("energy")}
              currentValue={currentValues.energy}
              label="Energy (1-10)"
              onBarClick={handleDateClick}
              selectedDate={selectedDate}
            />
            <WellnessBarChart
              metric="sleep"
              data={prepareChartData("sleep")}
              currentValue={currentValues.sleep}
              label="Sleep Quality (1-10)"
              onBarClick={handleDateClick}
              selectedDate={selectedDate}
            />
            <WellnessBarChart
              metric="stress"
              data={prepareChartData("stress")}
              currentValue={currentValues.stress}
              label="Stress Level (1-10)"
              onBarClick={handleDateClick}
              selectedDate={selectedDate}
            />
          </div>
          
        {/* Adherence Dot Rows */}
        <div className="space-y-4 pt-4 border-t">
          <AdherenceDotRow
            logs={logs}
            type="nutrition"
            label="Nutrition Adherence"
            onDotClick={handleDateClick}
            selectedDate={selectedDate}
          />
          <AdherenceDotRow
            logs={logs}
            type="training"
            label="Training Completion"
            onDotClick={handleDateClick}
            selectedDate={selectedDate}
          />
        </div>
      </CardContent>
      
      {/* Overlay Backdrop and Day Detail */}
      <AnimatePresence>
        {selectedLog && (
          <>
            {/* Semi-transparent backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/5 rounded-lg z-[5] cursor-pointer"
              onClick={() => setSelectedDate(null)}
            />
            
            {/* Day Detail Overlay */}
            <DayDetailCard
              log={selectedLog}
              habits={selectedHabits}
              onClose={() => setSelectedDate(null)}
            />
          </>
        )}
      </AnimatePresence>
    </Card>
  )
}