"use client"

import { motion } from "framer-motion"
import { MessageSquare, User, TrendingDown, TrendingUp, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { MetricSparkline } from "./metric-sparkline"
import type { AttentionAlert } from "@/types/attention-feed"

interface AttentionCardProps {
  clientId: string
  clientName: string
  clientAvatar: string | null
  alert: AttentionAlert
  index: number
}

export function AttentionCard({ 
  clientId, 
  clientName, 
  clientAvatar, 
  alert,
  index 
}: AttentionCardProps) {
  // Get icon based on alert type
  const getAlertIcon = () => {
    switch (alert.type) {
      case "mood_drop":
      case "energy_drop":
        return <TrendingDown className="h-4 w-4" />
      case "high_stress":
        return <TrendingUp className="h-4 w-4" />
      default:
        return <AlertTriangle className="h-4 w-4" />
    }
  }

  // Get color based on severity
  const getSeverityColor = () => {
    switch (alert.severity) {
      case "high":
        return "text-destructive"
      case "medium":
        return "text-warning"
      default:
        return "text-muted-foreground"
    }
  }

  // Get sparkline color based on alert type
  const getSparklineColor = () => {
    switch (alert.type) {
      case "mood_drop":
      case "energy_drop":
      case "high_stress":
        return "#ef4444" // Red for problematic metrics
      case "nutrition_missed":
        return "#f59e0b" // Amber for nutrition
      default:
        return "#3b82f6" // Blue default
    }
  }

  const initials = clientName
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="rounded-lg glass-card shadow-custom-sm p-4 hover:shadow-custom-md transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          {/* Client Avatar */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xs bg-primary/10 text-primary text-sm font-medium">
            {clientAvatar ? (
              <img
                src={clientAvatar}
                alt={clientName}
                className="h-full w-full rounded-xs object-cover"
              />
            ) : (
              initials
            )}
          </div>

          {/* Alert Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-sm truncate">{clientName}</h4>
              <span className={`flex items-center gap-1 ${getSeverityColor()}`}>
                {getAlertIcon()}
              </span>
            </div>
            
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
              {alert.message}
            </p>

            {/* Sparkline */}
            {alert.metricData && alert.metricData.length > 0 && (
              <div className="h-10 w-full mb-2">
                <MetricSparkline 
                  data={alert.metricData} 
                  color={getSparklineColor()}
                  height={40}
                />
              </div>
            )}

            {/* Affected Days */}
            <p className="text-xs text-muted-foreground">
              Affected: {alert.affectedDays.slice(0, 3).join(", ")}
              {alert.affectedDays.length > 3 && ` +${alert.affectedDays.length - 3} more`}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 ml-3">
          <Link href={`/messages?client=${clientId}`}>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex h-8 w-8 items-center justify-center rounded-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              title="Message client"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </motion.button>
          </Link>
          <Link href={`/clients/${clientId}`}>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex h-8 w-8 items-center justify-center rounded-xs bg-secondary/10 text-secondary hover:bg-secondary/20 transition-colors"
              title="View client"
            >
              <User className="h-3.5 w-3.5" />
            </motion.button>
          </Link>
        </div>
      </div>
    </motion.div>
  )
}