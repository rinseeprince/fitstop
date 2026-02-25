"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type WellnessMetric = "mood" | "energy" | "sleep" | "stress"

interface WellnessBarChartProps {
  metric: WellnessMetric
  data: Array<{
    date: string
    value: number | null
  }>
  currentValue?: number
  label: string
}

const getBarColor = (metric: WellnessMetric, value: number | null): string => {
  if (value === null) return "#e5e7eb" // Grey for no data
  
  switch (metric) {
    case "mood":
      if (value >= 4) return "#10b981" // Green
      if (value === 3) return "#f59e0b" // Amber
      return "#ef4444" // Red (1-2)
    
    case "energy":
    case "sleep":
      if (value >= 7) return "#10b981" // Green
      if (value >= 4) return "#f59e0b" // Amber
      return "#ef4444" // Red (1-3)
    
    case "stress":
      // Inverted - lower is better
      if (value <= 3) return "#10b981" // Green
      if (value <= 6) return "#f59e0b" // Amber
      return "#ef4444" // Red (7-10)
    
    default:
      return "#e5e7eb"
  }
}

const getMetricStats = (data: Array<{ value: number | null }>) => {
  const validValues = data
    .map(d => d.value)
    .filter((v): v is number => v !== null)
  
  if (validValues.length === 0) {
    return { min: null, avg: null, max: null }
  }
  
  return {
    min: Math.min(...validValues),
    avg: Math.round(validValues.reduce((a, b) => a + b, 0) / validValues.length * 10) / 10,
    max: Math.max(...validValues)
  }
}

const getYAxisDomain = (metric: WellnessMetric): [number, number] => {
  if (metric === "mood") return [0, 5]
  return [0, 10]
}

export function WellnessBarChart({
  metric,
  data,
  currentValue,
  label
}: WellnessBarChartProps) {
  const stats = getMetricStats(data)
  const yDomain = getYAxisDomain(metric)
  
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload[0]) return null
    
    const value = payload[0].value
    const date = payload[0].payload.date
    
    return (
      <div className="bg-popover border rounded-lg p-2 shadow-md">
        <p className="text-xs text-muted-foreground">{date}</p>
        <p className="text-sm font-medium">
          {value !== null ? `${value}` : "No data"}
        </p>
      </div>
    )
  }
  
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
            {currentValue !== undefined && (
              <span className="text-lg font-bold">{currentValue}</span>
            )}
          </div>
          
          <div className="h-[160px] w-full -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={data} 
                margin={{ top: 10, right: 5, bottom: 5, left: 5 }}
              >
                <XAxis 
                  dataKey="date"
                  hide
                />
                <YAxis 
                  hide 
                  domain={yDomain}
                />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{ fill: "transparent" }}
                />
                <Bar 
                  dataKey="value"
                  radius={[2, 2, 0, 0]}
                >
                  {data.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={getBarColor(metric, entry.value)} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Min: {stats.min !== null ? stats.min : "—"}</span>
            <span>Avg: {stats.avg !== null ? stats.avg : "—"}</span>
            <span>Max: {stats.max !== null ? stats.max : "—"}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}