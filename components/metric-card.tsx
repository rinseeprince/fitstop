"use client"

import { motion } from "framer-motion"
import type { LucideIcon } from "lucide-react"
import { AnimatedCounter } from "./animated-counter"
import { TrendingUp, TrendingDown } from "lucide-react"
import { Sparkline } from "./ui/chart"

interface MetricCardProps {
  title: string
  value: number
  icon: LucideIcon
  trend?: { value: string; positive: boolean }
  chart?: number[]
  delay?: number
}

export function MetricCard({ title, value, icon: Icon, trend, chart, delay = 0 }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: "easeOut" }}
      whileHover={{ scale: 1.02, transition: { duration: 0.15 } }}
      className="group relative overflow-hidden rounded-lg glass-card shadow-custom-md p-6 transition-all duration-150 hover:shadow-custom-lg"
    >
      <motion.div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        style={{
          background: "radial-gradient(circle at top right, hsl(var(--primary) / 0.08), transparent 60%)",
        }}
      />

      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground mb-3">{title}</p>
          <div className="flex items-baseline gap-2">
            <motion.h3 className="text-4xl font-semibold tracking-tight">
              <AnimatedCounter value={value} />
            </motion.h3>
            {trend && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: delay + 0.2 }}
                className={`flex items-center gap-1 text-xs font-medium ${
                  trend.positive ? "text-success" : "text-destructive"
                }`}
              >
                {trend.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {trend.value}
              </motion.div>
            )}
          </div>
        </div>

        <motion.div
          whileHover={{ scale: 1.1 }}
          transition={{ duration: 0.15 }}
          className="flex h-12 w-12 items-center justify-center rounded-xs bg-primary/10 text-primary transition-all duration-150 group-hover:bg-primary/20"
        >
          <Icon className="h-5 w-5" />
        </motion.div>
      </div>

      {chart && chart.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.3, duration: 0.3 }}
          className="mt-4"
        >
          <Sparkline data={chart} color="hsl(var(--primary))" />
        </motion.div>
      )}
    </motion.div>
  )
}
