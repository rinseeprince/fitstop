"use client"

import { useState, useEffect } from "react"
import useSWR from "swr"
import { motion } from "framer-motion"
import { AlertCircle, CheckCircle } from "lucide-react"
import { AttentionCard } from "./attention-card"
import type { AttentionFeedResponse } from "@/types/attention-feed"

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

  if (isLoading) {
    return (
      <div className="rounded-lg glass-card shadow-custom-md p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Needs Attention</h2>
          <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground">Checking client alerts...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg glass-card shadow-custom-md p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Needs Attention</h2>
          <AlertCircle className="h-5 w-5 text-destructive" />
        </div>
        <p className="text-sm text-muted-foreground">Failed to load attention feed. Please refresh to try again.</p>
      </div>
    )
  }

  const clients = data?.clients || []
  const totalAlerts = clients.reduce((sum, client) => sum + client.alerts.length, 0)
  const highSeverityCount = clients.reduce(
    (sum, client) => sum + client.alerts.filter(a => a.severity === "high").length, 
    0
  )

  if (clients.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-lg glass-card shadow-custom-md p-6 mb-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Needs Attention</h2>
          <motion.div
            whileHover={{ scale: 1.1 }}
            transition={{ duration: 0.15 }}
            className="flex h-9 w-9 items-center justify-center rounded-xs bg-success/10"
          >
            <CheckCircle className="h-5 w-5 text-success" />
          </motion.div>
        </div>
        <p className="text-sm text-muted-foreground">All clients tracking well</p>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg glass-card shadow-custom-md p-6 mb-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Needs Attention</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalAlerts} alert{totalAlerts !== 1 ? 's' : ''} across {clients.length} client{clients.length !== 1 ? 's' : ''}
            {highSeverityCount > 0 && (
              <span className="text-destructive ml-1">
                ({highSeverityCount} high priority)
              </span>
            )}
          </p>
        </div>
        <motion.div
          whileHover={{ scale: 1.1 }}
          transition={{ duration: 0.15 }}
          className="flex h-9 w-9 items-center justify-center rounded-xs bg-warning/10"
        >
          <AlertCircle className="h-5 w-5 text-warning" />
        </motion.div>
      </div>

      <div className="space-y-3">
        {clients.map((client, clientIndex) => (
          <div key={client.clientId}>
            {client.alerts.map((alert, alertIndex) => (
              <AttentionCard
                key={`${client.clientId}-${alert.type}-${alertIndex}`}
                clientId={client.clientId}
                clientName={client.clientName}
                clientAvatar={client.clientAvatar}
                alert={alert}
                index={clientIndex}
              />
            ))}
          </div>
        ))}
      </div>
    </motion.div>
  )
}