"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { WellnessBarChart } from "./wellness-bar-chart"
import { AdherenceDotRow } from "./adherence-dot-row"
import { getDateDaysAgo } from "@/lib/date-helpers"
import type { DailyLog } from "@/types/daily-log"

interface DailyWellnessStripProps {
  clientId: string
}

export function DailyWellnessStrip({ clientId }: DailyWellnessStripProps) {
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const startDate = getDateDaysAgo(28)
        const endDate = new Date().toISOString().split('T')[0]
        
        const response = await fetch(
          `/api/clients/${clientId}/daily-logs?startDate=${startDate}&endDate=${endDate}`,
          { cache: 'no-store' }
        )
        
        if (!response.ok) {
          console.error('Failed to fetch daily logs')
          return
        }
        
        const data = await response.json()
        setLogs(data.data || [])
      } catch (error) {
        console.error('Error fetching daily logs:', error)
      } finally {
        setIsLoading(false)
      }
    }
    
    fetchLogs()
  }, [clientId])
  
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
  
  // Calculate days logged this week
  const today = new Date()
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7)) // Start on Monday
  weekStart.setHours(0, 0, 0, 0)
  
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const daysLoggedThisWeek = logs.filter(log => log.date >= weekStartStr).length
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Daily Wellness</CardTitle>
            <span className="text-sm text-muted-foreground">
              {daysLoggedThisWeek}/7 days logged this week
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Wellness Charts Grid */}
          <div className="grid gap-4 md:grid-cols-2">
            <WellnessBarChart
              metric="mood"
              data={prepareChartData("mood")}
              currentValue={currentValues.mood}
              label="Mood (1-5)"
            />
            <WellnessBarChart
              metric="energy"
              data={prepareChartData("energy")}
              currentValue={currentValues.energy}
              label="Energy (1-10)"
            />
            <WellnessBarChart
              metric="sleep"
              data={prepareChartData("sleep")}
              currentValue={currentValues.sleep}
              label="Sleep Quality (1-10)"
            />
            <WellnessBarChart
              metric="stress"
              data={prepareChartData("stress")}
              currentValue={currentValues.stress}
              label="Stress Level (1-10)"
            />
          </div>
          
          {/* Adherence Dot Rows */}
          <div className="space-y-4 pt-4 border-t">
            <AdherenceDotRow
              logs={logs}
              type="nutrition"
              label="Nutrition Adherence"
            />
            <AdherenceDotRow
              logs={logs}
              type="training"
              label="Training Completion"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}