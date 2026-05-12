"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { CheckCircle, ChevronDown, ChevronUp, X } from "lucide-react"
import useSWR from "swr"
import type { AttentionFeedResponse, AttentionAlert, AlertType } from "@/types/attention-feed"

const alertTabMap: Record<AlertType, string> = {
  mood_drop: "wellness",
  energy_drop: "wellness",
  high_stress: "wellness",
  no_log_gap: "wellness",
  nutrition_missed: "nutrition",
  activity_cal_mismatch: "nutrition",
  training_missed: "training",
  partial_training_pattern: "training",
  habit_dropoff: "daily-habits",
}

function AlertRow({ clientId, alert, onDismiss }: {
  clientId: string
  alert: AttentionAlert
  onDismiss: (clientId: string, alertType: string) => void
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          alert.severity === "high" ? "bg-[#b91c1c]" : "bg-[#d97706]"
        }`} />
        <span className="text-xs text-[#5a7d82] truncate">
          {alert.message}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          href={`/clients/${clientId}?tab=${alertTabMap[alert.type]}`}
          className="text-xs text-[#0d9488] hover:text-[#0f766e]"
        >
          View
        </Link>
        <button
          onClick={() => onDismiss(clientId, alert.type)}
          className="text-[#93b0b4] hover:text-[#0c1a1e]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) {
    throw new Error("Failed to fetch attention feed")
  }
  const data: AttentionFeedResponse = await response.json()
  return data.data
}

export function NeedsAttentionFeed() {
  const { data, error, isLoading, mutate } = useSWR(
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
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set())

  const toggleExpanded = (clientId: string) => {
    setExpandedClients(prev => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  const handleDismiss = async (clientId: string, alertType: string) => {
    try {
      const res = await fetch("/api/dashboard/attention-feed/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, alertType }),
      })
      if (!res.ok) throw new Error("Failed to dismiss")
      void mutate()
    } catch (err) {
      console.error("Failed to dismiss alert:", err)
    }
  }

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
      case "partial_training_pattern":
        return `${days} sessions partial`
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
      case "partial_training_pattern":
        return `${days} of recent sessions only partially completed`
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
      className="bg-white rounded-[6px] p-5 mb-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold tracking-tight text-[#0c1a1e]">Needs Attention</h3>
        {/* Badge only when data is loaded */}
        {data && (
          <span className="bg-[rgba(13,148,136,0.08)] text-[#0d9488] text-xs font-medium px-2 py-0.5 rounded-[4px] font-mono-display">
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
          <CheckCircle className="w-4 h-4 text-[#0d9488]" strokeWidth={1.5} />
          <span className="text-sm text-[#5a7d82]">All clients on track</span>
        </div>
      ) : (
        /* Populated content: priority client + compact list */
        <>
          {/* Priority client section */}
          {priorityClient && (() => {
            const topAlert = priorityClient.alerts.find(a => a.severity === "high") || priorityClient.alerts[0]
            const isExpanded = expandedClients.has(priorityClient.clientId)
            return (
              <div className="bg-[rgba(245,158,11,0.07)] rounded-[6px] p-3 mb-3">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div
                    className="w-10 h-10 rounded-[6px] flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                    style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
                  >
                    {priorityClient.clientAvatar ? (
                      <img
                        src={priorityClient.clientAvatar}
                        alt={priorityClient.clientName}
                        className="w-full h-full rounded-[6px] object-cover"
                      />
                    ) : (
                      <span>
                        {priorityClient.clientName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-[#0c1a1e]">{priorityClient.clientName}</h4>
                    </div>
                    <p className="text-xs text-[#5a7d82] mt-1">
                      {getPriorityAlertText(topAlert)}
                    </p>
                    {priorityClient.alerts.length > 1 && (
                      <button
                        onClick={() => toggleExpanded(priorityClient.clientId)}
                        className="flex items-center gap-1 text-xs text-[#93b0b4] hover:text-[#5a7d82] mt-1"
                      >
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {isExpanded ? "Hide" : `+${priorityClient.alerts.length - 1} more`} alert{priorityClient.alerts.length > 2 ? "s" : ""}
                      </button>
                    )}
                    {isExpanded && (
                      <div className="mt-2 border-t border-[rgba(13,148,136,0.1)] pt-1.5">
                        {priorityClient.alerts.map(alert => (
                          <AlertRow
                            key={alert.type}
                            clientId={priorityClient.clientId}
                            alert={alert}
                            onDismiss={handleDismiss}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Compact list */}
          {visibleCompactClients.length > 0 && (
            <div className="divide-y divide-[rgba(13,148,136,0.08)]">
              {visibleCompactClients.map(client => {
                const highAlerts = client.alerts.filter(a => a.severity === "high").length
                const hasOnlyMedium = highAlerts === 0 && client.alerts.some(a => a.severity === "medium")
                const mostUrgentAlert = client.alerts.find(a => a.severity === "high") || client.alerts[0]
                const isExpanded = expandedClients.has(client.clientId)

                return (
                  <div key={client.clientId} className="py-2">
                    <button
                      onClick={() => toggleExpanded(client.clientId)}
                      className="flex items-start justify-between w-full text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#0c1a1e]">{client.clientName}</span>
                          {client.alerts.length > 0 && (
                            <span className={`${
                              hasOnlyMedium
                                ? "bg-[rgba(245,158,11,0.07)] text-[#d97706]"
                                : "bg-[rgba(185,28,28,0.08)] text-[#b91c1c]"
                            } text-xs font-medium px-1.5 py-0.5 rounded-[4px] font-mono-display`}>
                              {client.alerts.length}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#5a7d82] mt-1">
                          {getShortAlertText(mostUrgentAlert)}
                          {!isExpanded && client.alerts.length > 1 && ` +${client.alerts.length - 1}`}
                        </p>
                      </div>
                      <span className="text-[#93b0b4] hover:text-[#5a7d82] flex-shrink-0 mt-0.5">
                        {isExpanded
                          ? <ChevronUp className="w-4 h-4" />
                          : <ChevronDown className="w-4 h-4" />
                        }
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="ml-0 mt-1 pl-2 border-l-2 border-[rgba(13,148,136,0.1)]">
                        {client.alerts.map(alert => (
                          <AlertRow
                            key={alert.type}
                            clientId={client.clientId}
                            alert={alert}
                            onDismiss={handleDismiss}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Show more link */}
          {hiddenCount > 0 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs text-[#5a7d82] hover:text-[#0c1a1e] mt-2"
            >
              and {hiddenCount} more
            </button>
          )}

          {showAll && compactListClients.length > 4 && (
            <button
              onClick={() => setShowAll(false)}
              className="text-xs text-[#5a7d82] hover:text-[#0c1a1e] mt-2"
            >
              Show less
            </button>
          )}
        </>
      )}
    </motion.div>
  )
}
