"use client"

import { motion } from "framer-motion"
import Link from "next/link"
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
  href?: string
}

export function MetricCard({ title, value, icon: Icon, trend, chart, delay = 0, href }: MetricCardProps) {
  const content = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.2, ease: "easeOut" }}
      className={`group relative overflow-hidden rounded-lg bg-card border border-border p-6 transition-colors duration-150 hover:border-primary/30 ${href ? "cursor-pointer" : ""}`}
    >
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

        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors duration-150 group-hover:bg-primary/15">
          <Icon className="h-5 w-5" />
        </div>
      </div>

      {chart && chart.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.3, duration: 0.2 }}
          className="mt-4"
        >
          <Sparkline data={chart} color="hsl(var(--primary))" />
        </motion.div>
      )}
    </motion.div>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }

  return content
}
