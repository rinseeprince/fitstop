"use client"

import useSWR from "swr"
import { motion } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ClipboardCheck, ChevronRight, Bell, UserPlus } from "lucide-react"
import Link from "next/link"
import type { PendingIntakeSummary } from "@/types/client-intake"

import { swrFetcher } from "@/lib/swr-fetcher"

export function PendingIntakeBanner() {
  const { data, isLoading } = useSWR<{ success: boolean; data: PendingIntakeSummary[] }>(
    "/api/coach/pending-intakes",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      onError: (err) => console.error("Failed to fetch pending intakes:", err),
    }
  )

  const intakes = data?.data ?? []

  if (isLoading || intakes.length === 0) return null

  const completedCount = intakes.filter((i) => i.status === "completed").length

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.05 }}
      className="bg-card border border-border rounded-lg p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-primary" />
          <h3 className="text-base font-semibold tracking-tight">
            Pending Onboarding ({intakes.length})
          </h3>
        </div>
        {completedCount > 0 && (
          <Badge variant="default">
            {completedCount} ready for review
          </Badge>
        )}
      </div>

      <div className="divide-y divide-border">
        {intakes.map((intake) => {
          const isComplete = intake.status === "completed"
          const initials = intake.clientName
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2)

          const inviteDate = new Date(intake.invitedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })

          return (
            <div key={intake.id} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-medium text-primary">{initials}</span>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{intake.clientName}</p>
                <p className="text-xs text-muted-foreground">Invited {inviteDate}</p>
              </div>

              <Badge variant={isComplete ? "default" : "warning"}>
                {isComplete ? "Intake Complete" : "Pending"}
              </Badge>

              {isComplete ? (
                <Link href={`/clients/${intake.clientId}/intake-review`}>
                  <Button size="sm" variant="outline" className="gap-1">
                    Review
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </Link>
              ) : (
                <Button size="sm" variant="ghost" disabled title="Coming soon">
                  <Bell className="w-3 h-3" />
                  Send Reminder
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
