"use client"

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import type { ActiveDotType } from "recharts/types/util/types"
import { Card, CardContent } from "@/components/ui/card"
import type { WellnessMetric } from "@/utils/wellness-color-thresholds"

const DEFAULT_LINE_COLORS: Record<WellnessMetric, string> = {
  mood: "#c8923a",
  energy: "#0d9488",
  sleep: "#c8923a",
  stress: "#c8923a",
  // Compile-closure only: this frozen legacy strip never renders soreness,
  // but the exhaustive Record must cover the widened WellnessMetric union.
  soreness: "#c8923a",
}

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
  barColorOverride?: string
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
  selectedDate,
  barColorOverride
}: WellnessBarChartProps) {
  const stats = getMetricStats(data)
  const yDomain = getYAxisDomain(metric)
  const lineColor = barColorOverride || DEFAULT_LINE_COLORS[metric]
  
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ value: number | null; payload: { date: string } }> }) => {
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
              <LineChart
                data={data}
                margin={{ top: 10, right: 5, bottom: 5, left: 5 }}
              >
                <XAxis dataKey="date" hide />
                <YAxis hide domain={yDomain} />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{ stroke: "rgba(13,148,136,0.15)", strokeWidth: 1 }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={2}
                  connectNulls
                  dot={(props: Record<string, unknown>) => {
                    const { cx, cy, payload, index } = props as {
                      cx: number
                      cy: number
                      payload: { dateStr?: string; value: number | null }
                      index: number
                    }
                    if (payload.value === null) return <g key={`dot-${index}`} />
                    const isSelected = payload.dateStr === selectedDate
                    return (
                      <circle
                        key={`dot-${index}`}
                        cx={cx}
                        cy={cy}
                        r={isSelected ? 5 : 3}
                        fill={isSelected ? lineColor : "#fff"}
                        stroke={lineColor}
                        strokeWidth={isSelected ? 2 : 1.5}
                        style={{ cursor: onBarClick ? "pointer" : "default" }}
                        onClick={() => {
                          if (onBarClick && payload.dateStr) onBarClick(payload.dateStr)
                        }}
                      />
                    )
                  }}
                  activeDot={((props: Record<string, unknown>) => {
                    const { cx, cy, payload, index } = props as {
                      cx: number
                      cy: number
                      payload: { dateStr?: string }
                      index: number
                    }
                    return (
                      <circle
                        key={`active-${index}`}
                        cx={cx}
                        cy={cy}
                        r={5}
                        fill={lineColor}
                        stroke="#fff"
                        strokeWidth={2}
                        style={{ cursor: onBarClick ? "pointer" : "default" }}
                        onClick={() => {
                          if (onBarClick && payload.dateStr) onBarClick(payload.dateStr)
                        }}
                      />
                    )
                  }) as ActiveDotType}
                />
              </LineChart>
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