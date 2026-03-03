"use client"

import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts"
import type { MetricDataPoint } from "@/lib/attention-triggers"

interface MetricSparklineProps {
  data: MetricDataPoint[]
  color?: string
  height?: number
}

export function MetricSparkline({ 
  data, 
  color = "#3b82f6",
  height = 40 
}: MetricSparklineProps) {
  if (!data || data.length === 0) {
    return null
  }

  // Format data for Recharts
  const chartData = data.map(point => ({
    value: point.value
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 5, right: 0, bottom: 5, left: 0 }}>
        <YAxis hide />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          animationDuration={300}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}