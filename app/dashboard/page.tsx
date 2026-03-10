"use client"

import { useMemo } from "react"
import useSWR from "swr"
import { AppLayout } from "@/components/app-layout"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { CoachTipCard } from "@/components/coach-tip-card"
import { FloatingActionButton } from "@/components/floating-action-button"
import { NeedsAttentionFeed } from "@/components/dashboard/needs-attention-feed"
import { PendingIntakeBanner } from "@/components/coach/pending-intake-banner"
import { Users, MessageSquare, PhoneCall, Clock, TrendingUp, AlertCircle } from "lucide-react"
import { motion } from "framer-motion"
import { formatRelativeTime } from "@/lib/check-in-utils"
import type { CheckInStatus } from "@/types/check-in"
import Link from "next/link"

type RecentCheckIn = {
  id: string
  clientId: string
  clientName: string
  clientAvatar: string | null
  status: CheckInStatus
  createdAt: string
}

const fetcher = async (url: string) => { const r = await fetch(url); return r.json() }

export default function DashboardPage() {
  const { data, isLoading } = useSWR<{ checkIns: RecentCheckIn[] }>(
    "/api/check-ins/recent",
    fetcher,
    { revalidateOnFocus: false }
  )
  const recentCheckIns = data?.checkIns ?? []
  const unreviewedCount = useMemo(
    () => recentCheckIns.filter((ci) => ci.status === "ai_processed").length,
    [recentCheckIns]
  )

  const pageHeader = (
    <PageHeader
      title="Welcome back, Coach!"
      description="Here's what's happening with your clients today"
    />
  )

  return (
    <AppLayout pageHeader={pageHeader}>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Pending Onboarding Banner */}
        <PendingIntakeBanner />

        {/* Needs Attention Feed */}
        <NeedsAttentionFeed />

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Active Clients"
            value={24}
            icon={Users}
            trend={{ value: "+3 this month", positive: true }}
            chart={[12, 15, 18, 20, 22, 24]}
            delay={0.05}
          />
          <MetricCard
            title="Unreviewed Check-ins"
            value={unreviewedCount}
            icon={AlertCircle}
            trend={{
              value: unreviewedCount > 0 ? "Action required" : "All caught up!",
              positive: unreviewedCount === 0,
            }}
            chart={[2, 3, 1, 2, 4, unreviewedCount]}
            delay={0.1}
            href="/check-ins/review"
          />
          <MetricCard title="Unread Messages" value={7} icon={MessageSquare} chart={[12, 10, 8, 9, 8, 7]} delay={0.15} />
          <MetricCard title="Upcoming Calls" value={5} icon={PhoneCall} chart={[3, 4, 6, 5, 4, 5]} delay={0.2} />
        </div>

        <CoachTipCard />

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent Check-ins */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.2 }}
            className="rounded-lg bg-card border border-border p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold tracking-tight">Recent Check-ins</h2>
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-success/10">
                <TrendingUp className="h-4 w-4 text-success" />
              </div>
            </div>
            <div className="space-y-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : recentCheckIns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No recent check-ins
                </div>
              ) : (
                recentCheckIns.slice(0, 5).map((checkIn, i) => {
                  const initials = checkIn.clientName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)

                  return (
                    <Link key={checkIn.id} href={`/clients/${checkIn.clientId}`}>
                      <div className="group flex items-center justify-between rounded-md p-3 transition-colors duration-150 hover:bg-muted/50 cursor-pointer">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary text-sm font-medium">
                            {checkIn.clientAvatar ? (
                              <img
                                src={checkIn.clientAvatar}
                                alt={checkIn.clientName}
                                className="h-full w-full rounded-md object-cover"
                              />
                            ) : (
                              initials
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{checkIn.clientName}</p>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {formatRelativeTime(checkIn.createdAt)}
                            </div>
                          </div>
                        </div>
                        <div
                          className={`h-2 w-2 rounded-full ${
                            checkIn.status === "reviewed"
                              ? "bg-success"
                              : checkIn.status === "ai_processed"
                                ? "bg-primary"
                                : "bg-warning"
                          }`}
                        />
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          </motion.div>

          {/* Upcoming Calls */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.2 }}
            className="rounded-lg bg-card border border-border p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold tracking-tight">Upcoming Calls</h2>
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                <PhoneCall className="h-4 w-4 text-primary" />
              </div>
            </div>
            <div className="space-y-1">
              {[
                { name: "Lisa Anderson", time: "Today at 2:00 PM", type: "Initial Consultation", avatar: "LA" },
                { name: "Tom Martinez", time: "Today at 4:30 PM", type: "Progress Review", avatar: "TM" },
                { name: "Anna Taylor", time: "Tomorrow at 10:00 AM", type: "Program Planning", avatar: "AT" },
                { name: "David Brown", time: "Tomorrow at 3:00 PM", type: "Check-in Call", avatar: "DB" },
              ].map((call, i) => (
                <div
                  key={i}
                  className="group flex items-start gap-3 rounded-md p-3 transition-colors duration-150 hover:bg-muted/50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground text-sm font-medium">
                    {call.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{call.name}</p>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                      <Clock className="h-3 w-3" />
                      {call.time}
                    </div>
                    <p className="text-xs text-primary font-medium mt-1">{call.type}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      <FloatingActionButton />
    </AppLayout>
  )
}
