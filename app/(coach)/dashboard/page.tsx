"use client"

import useSWR from "swr"
import { AppLayout } from "@/components/app-layout"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { CoachTipCard } from "@/components/coach-tip-card"
import { NeedsAttentionFeed } from "@/components/dashboard/needs-attention-feed"
import { PendingIntakeBanner } from "@/components/coach/pending-intake-banner"
import { Users, MessageSquare, PhoneCall, Clock, TrendingUp, AlertCircle } from "lucide-react"
import { motion } from "framer-motion"
import { formatRelativeTime } from "@/lib/check-in-utils"
import { useUnreviewedCheckInClientCount } from "@/hooks/use-client-attention"
import { checkInReviewUrl } from "@/lib/client-tabs"
import { rosterViewLabel, rosterViewUrl } from "@/lib/roster-views"
import { MONO } from "@/components/clients/training/program-builder/builder-tokens"
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

import { swrFetcher } from "@/lib/swr-fetcher"

export default function DashboardPage() {
  const { data, isLoading } = useSWR<{ checkIns: RecentCheckIn[] }>(
    "/api/check-ins/recent",
    swrFetcher,
    { revalidateOnFocus: false }
  )
  const recentCheckIns = data?.checkIns ?? []

  // The card counts CLIENTS with a check-in waiting, through the one hook the
  // nav badge uses, so the number and the page it opens can never disagree.
  // It used to count `ai_processed` rows inside /recent's newest 10 — which
  // under-reported a busy week, missed `pending` rows entirely, and pointed at
  // a queue page that no longer exists. Costs no request: /api/check-ins/
  // unreviewed is already mounted by the coach layout's
  // CheckInNotificationListener (app/(coach)/layout.tsx).
  const unreviewedClients = useUnreviewedCheckInClientCount()

  const pageHeader = (
    <PageHeader
      title="Welcome back, Coach!"
      description="Here's what's happening with your clients today"
    />
  )

  return (
    <AppLayout pageHeader={pageHeader}>
      <div className="space-y-6">
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
            title={rosterViewLabel("review")}
            value={unreviewedClients}
            icon={AlertCircle}
            trend={{
              value: unreviewedClients > 0 ? "Action required" : "All caught up!",
              positive: unreviewedClients === 0,
            }}
            chart={[2, 3, 1, 2, 4, unreviewedClients]}
            delay={0.1}
            href={rosterViewUrl("review")}
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
            className="rounded-[6px] bg-white p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold tracking-tight text-[#0c1a1e]">Recent Check-ins</h2>
              <div className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-[rgba(13,148,136,0.08)]">
                <TrendingUp className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
              </div>
            </div>
            <div className="space-y-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-4 border-[rgba(13,148,136,0.10)] border-t-[#0d9488] rounded-full animate-spin" />
                </div>
              ) : recentCheckIns.length === 0 ? (
                <div className="text-center py-8 text-[#93b0b4] text-sm">
                  No recent check-ins
                </div>
              ) : (
                recentCheckIns.slice(0, 5).map((checkIn, _i) => {
                  const initials = checkIn.clientName
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)

                  return (
                    // Straight to the check-in this row names, not the client
                    // page's default tab — through the single writer of that URL.
                    <Link
                      key={checkIn.id}
                      href={checkInReviewUrl(checkIn.clientId, checkIn.id)}
                    >
                      <div className="group flex items-center justify-between rounded-[6px] p-3 transition-colors duration-150 hover:bg-[rgba(0,0,0,0.02)] cursor-pointer">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-[6px] text-white text-xs font-bold"
                            style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
                          >
                            {checkIn.clientAvatar ? (
                              <img
                                src={checkIn.clientAvatar}
                                alt={checkIn.clientName}
                                className="h-full w-full rounded-[6px] object-cover"
                              />
                            ) : (
                              initials
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-sm text-[#0c1a1e]">{checkIn.clientName}</p>
                            <div className="flex items-center gap-1.5 text-xs text-[#93b0b4]">
                              <Clock className="h-3 w-3" strokeWidth={1.5} />
                              <span className={MONO}>{formatRelativeTime(checkIn.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div
                          className={`h-2 w-2 rounded-full ${
                            checkIn.status === "reviewed"
                              ? "bg-[#0d9488]"
                              : checkIn.status === "ai_processed"
                                ? "bg-[#0d9488]"
                                : "bg-[#d97706]"
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
            className="rounded-[6px] bg-white p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-semibold tracking-tight text-[#0c1a1e]">Upcoming Calls</h2>
              <div className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-[rgba(13,148,136,0.08)]">
                <PhoneCall className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
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
                  className="group flex items-start gap-3 rounded-[6px] p-3 transition-colors duration-150 hover:bg-[rgba(0,0,0,0.02)]"
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] text-white text-xs font-bold"
                    style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
                  >
                    {call.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-[#0c1a1e]">{call.name}</p>
                    <div className="flex items-center gap-1.5 text-xs text-[#93b0b4] mt-0.5">
                      <Clock className="h-3 w-3" strokeWidth={1.5} />
                      <span className={MONO}>{call.time}</span>
                    </div>
                    <p className="text-xs text-[#0d9488] font-medium mt-1">{call.type}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  )
}
