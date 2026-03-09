"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { getBarColor, type WellnessMetric } from "@/utils/wellness-color-thresholds"

interface WellnessBarChartProps {
  metric: WellnessMetric
  data: Array<{
    date: string
    dateStr?: string
    value: number | null
  }>
  currentValue?: number
  label: string
  onBarClick?: (dateStr: string) => void
  selectedDate?: string | null
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
  label,
  onBarClick,
  selectedDate
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
              <span className="text-lg font-semibold">{currentValue}</span>
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
                  onClick={(data: any) => {
                    if (onBarClick && data.dateStr) {
                      onBarClick(data.dateStr)
                    }
                  }}
                >
                  {data.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={getBarColor(metric, entry.value)}
                      stroke={entry.dateStr === selectedDate ? "#3b82f6" : "none"}
                      strokeWidth={entry.dateStr === selectedDate ? 2 : 0}
                      style={{ cursor: onBarClick ? 'pointer' : 'default' }}
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