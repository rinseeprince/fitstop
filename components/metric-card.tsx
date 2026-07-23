"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { AnimatedCounter } from "./animated-counter"
import { TrendingUp, TrendingDown } from "lucide-react"
import { Sparkline } from "./ui/chart"
import { cn } from "@/lib/utils"
import { LABEL_CLASS, MONO } from "@/components/clients/training/program-builder/builder-tokens"

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
      className={`group relative overflow-hidden rounded-[6px] bg-white p-6 transition-all duration-150 ${href ? "cursor-pointer hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]" : ""}`}
    >
      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className={cn(LABEL_CLASS, "mb-3")}>{title}</p>
          <div className="flex items-baseline gap-2">
            <motion.h3 className={cn(MONO, "text-[32px] font-bold tracking-[-0.02em] text-[#0c1a1e] leading-tight")}>
              <AnimatedCounter value={value} />
            </motion.h3>
            {trend && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: delay + 0.2 }}
                className={`flex items-center gap-1 text-xs font-medium ${
                  trend.positive ? "text-[#0d9488]" : "text-[#d97706]"
                }`}
              >
                {trend.positive ? <TrendingUp className="h-3 w-3" strokeWidth={1.5} /> : <TrendingDown className="h-3 w-3" strokeWidth={1.5} />}
                {trend.value}
              </motion.div>
            )}
          </div>
        </div>

        <div className="flex h-12 w-12 items-center justify-center rounded-[6px] bg-[rgba(13,148,136,0.08)] text-[#0d9488] transition-colors duration-150 group-hover:bg-[rgba(13,148,136,0.12)]">
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </div>
      </div>

      {chart && chart.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.3, duration: 0.2 }}
          className="mt-4"
        >
          <Sparkline data={chart} color="#0d9488" />
        </motion.div>
      )}
    </motion.div>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }

  return content
}
