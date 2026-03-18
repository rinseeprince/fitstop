"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { CheckCircle } from "lucide-react"
import useSWR from "swr"
import type { AttentionFeedResponse, AttentionAlert } from "@/types/attention-feed"

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) {
    throw new Error("Failed to fetch attention feed")
  }
  const data: AttentionFeedResponse = await response.json()
  return data.data
}

export function NeedsAttentionFeed() {
  const { data, error, isLoading } = useSWR(
    "/api/dashboard/attention-feed",
    fetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      dedupingInterval: 2000,
      onError: (error) => {
        console.error("Failed to fetch attention feed:", error)
      }
    }
  )

  const [showAll, setShowAll] = useState(false)

  // Helper functions for formatting
  const getShortAlertText = (alert: AttentionAlert): string => {
    const days = alert.affectedDays.length

    switch (alert.type) {
      case "mood_drop":
        return "Mood drop"
      case "energy_drop":
        return "Energy drop"
      case "high_stress":
        return `High stress (${days} days)`
      case "nutrition_missed":
        return `Nutrition missed (${days} days)`
      case "training_missed": {
        const match = alert.message.match(/(\d+)\s+.*sessions/)
        return `${match ? match[1] : days} sessions missed`
      }
      case "habit_dropoff": {
        const habitMatch = alert.message.match(/(\d+)\s+of.*?(\d+)\s+days/)
        return habitMatch ? `Low habits (${habitMatch[1]}/${habitMatch[2]} days)` : "Low habits"
      }
      case "activity_cal_mismatch":
        return "Overeating on rest days"
      default:
        return alert.message
    }
  }

  const getPriorityAlertText = (alert: AttentionAlert): string => {
    const days = alert.affectedDays.length

    switch (alert.type) {
      case "mood_drop": {
        const avg = alert.metricData.length > 0
          ? (alert.metricData.reduce((sum, d) => sum + d.value, 0) / alert.metricData.length).toFixed(1)
          : "low"
        return `Mood dropped to avg ${avg} for ${days} days`
      }
      case "energy_drop": {
        const avg = alert.metricData.length > 0
          ? (alert.metricData.reduce((sum, d) => sum + d.value, 0) / alert.metricData.length).toFixed(1)
          : "low"
        return `Energy dropped to avg ${avg} for ${days} days`
      }
      case "high_stress":
        return `Stress at 8+ for ${days} days`
      case "nutrition_missed":
        return `Nutrition targets missed for ${days} days`
      case "training_missed": {
        const match = alert.message.match(/(\d+)\s+training sessions/)
        const count = match ? match[1] : days
        return `Missed ${count} sessions this week`
      }
      case "habit_dropoff":
        return alert.message
      case "activity_cal_mismatch":
        return "Calorie intake matched activities despite skipping them"
      default:
        return alert.message
    }
  }

  // Return null only for errors
  if (error) return null

  const clients = data?.clients || []
  const totalClientCount = data?.totalClientCount || 0
  const clientsOnTrack = totalClientCount - clients.length

  // Sort clients: high severity first, then by alert count, then alphabetical
  const sortedClients = [...clients].sort((a, b) => {
    const aHighCount = a.alerts.filter(alert => alert.severity === "high").length
    const bHighCount = b.alerts.filter(alert => alert.severity === "high").length

    if (aHighCount !== bHighCount) {
      return bHighCount - aHighCount
    }

    if (a.alerts.length !== b.alerts.length) {
      return b.alerts.length - a.alerts.length
    }

    return a.clientName.localeCompare(b.clientName)
  })

  // Identify priority client (top client if they have high severity)
  const priorityClient = sortedClients[0]?.alerts.some(a => a.severity === "high")
    ? sortedClients[0]
    : null

  // Remaining clients for compact list (excluding priority if shown)
  const compactListClients = priorityClient
    ? sortedClients.slice(1)
    : sortedClients

  // Limit compact list to 4 items
  const visibleCompactClients = showAll
    ? compactListClients
    : compactListClients.slice(0, 4)

  const hiddenCount = compactListClients.length - 4

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.05 }}
      className="bg-card border border-border rounded-lg p-5 mb-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold tracking-tight">Needs Attention</h3>
        {/* Badge only when data is loaded */}
        {data && (
          <span className="bg-success/10 text-success text-xs font-medium px-2 py-0.5 rounded-md">
            {clientsOnTrack} of {totalClientCount} clients on track
          </span>
        )}
      </div>

      {/* Swap inner content based on state */}
      {isLoading ? (
        /* Empty space during loading */
        <div className="h-6" />
      ) : clients.length === 0 ? (
        /* Empty state content */
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-success" />
          <span className="text-sm text-muted-foreground">All clients on track</span>
        </div>
      ) : (
        /* Populated content: priority client + compact list */
        <>
          {/* Priority client section */}
          {priorityClient && (
            <div className="bg-destructive/5 border border-destructive/10 rounded-lg p-3 mb-3">
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  {priorityClient.clientAvatar ? (
                    <img
                      src={priorityClient.clientAvatar}
                      alt={priorityClient.clientName}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-sm font-medium text-primary">
                      {priorityClient.clientName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-foreground">{priorityClient.clientName}</h4>
                    <Link
                      href={`/clients/${priorityClient.clientId}`}
                      className="text-sm text-primary hover:text-primary/80 font-medium"
                    >
                      View
                    </Link>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getPriorityAlertText(
                      priorityClient.alerts.find(a => a.severity === "high") || priorityClient.alerts[0]
                    )}
                  </p>
                  {priorityClient.alerts.length > 1 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      +{priorityClient.alerts.length - 1} more alert{priorityClient.alerts.length > 2 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Compact list */}
          {visibleCompactClients.length > 0 && (
            <div className="divide-y divide-border">
              {visibleCompactClients.map(client => {
                const highAlerts = client.alerts.filter(a => a.severity === "high").length
                const hasOnlyMedium = highAlerts === 0 && client.alerts.some(a => a.severity === "medium")
                const mostUrgentAlert = client.alerts.find(a => a.severity === "high") || client.alerts[0]

                return (
                  <div key={client.clientId} className="py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm text-foreground">{client.clientName}</span>
                      {client.alerts.length > 0 && (
                        <span className={`${
                          hasOnlyMedium
                            ? "bg-warning/10 text-warning"
                            : "bg-destructive/10 text-destructive"
                        } text-xs font-medium px-1.5 py-0.5 rounded-md`}>
                          {client.alerts.length}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground truncate">
                        {getShortAlertText(mostUrgentAlert)}
                        {client.alerts.length > 1 && ` +${client.alerts.length - 1}`}
                      </span>
                    </div>
                    <Link
                      href={`/clients/${client.clientId}`}
                      className="text-sm text-primary hover:text-primary/80 flex-shrink-0"
                    >
                      View
                    </Link>
                  </div>
                )
              })}
            </div>
          )}

          {/* Show more link */}
          {hiddenCount > 0 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs text-muted-foreground hover:text-foreground mt-2"
            >
              and {hiddenCount} more
            </button>
          )}

          {showAll && compactListClients.length > 4 && (
            <button
              onClick={() => setShowAll(false)}
              className="text-xs text-muted-foreground hover:text-foreground mt-2"
            >
              Show less
            </button>
          )}
        </>
      )}
    </motion.div>
  )
}
