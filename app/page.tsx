"use client"

import { useEffect, useState } from "react"
import { AppLayout } from "@/components/app-layout"
import { MetricCard } from "@/components/metric-card"
import { CoachTipCard } from "@/components/coach-tip-card"
import { FloatingActionButton } from "@/components/floating-action-button"
import { Users, MessageSquare, PhoneCall, Activity, Clock, TrendingUp, AlertCircle } from "lucide-react"
import { motion } from "framer-motion"
import { formatRelativeTime } from "@/lib/check-in-utils"
import Link from "next/link"

type RecentCheckIn = {
  id: string
  clientId: string
  clientName: string
  clientAvatar: string | null
  status: string
  createdAt: string
}

export default function DashboardPage() {
  const [recentCheckIns, setRecentCheckIns] = useState<RecentCheckIn[]>([])
  const [unreviewedCount, setUnreviewedCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchRecentCheckIns = async () => {
      try {
        const response = await fetch("/api/check-ins/recent")
        if (response.ok) {
          const data = await response.json()
          setRecentCheckIns(data.checkIns || [])

          // Count unreviewed (ai_processed status)
          const unreviewed = (data.checkIns || []).filter(
            (ci: RecentCheckIn) => ci.status === "ai_processed"
          ).length
          setUnreviewedCount(unreviewed)
        }
      } catch (error) {
        console.error("Error fetching recent check-ins:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchRecentCheckIns()
  }, [])
  return (
    <AppLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative overflow-hidden rounded-lg gradient-subtle p-6 shadow-custom-md border border-border/50"
        >
          <div className="relative flex items-center gap-4">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center text-xl font-semibold text-primary"
            >
              CJ
            </motion.div>
            <div>
              <motion.h1
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
                className="text-2xl font-semibold text-balance mb-1"
              >
                Welcome back, Coach!
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2, duration: 0.3 }}
                className="text-muted-foreground text-sm"
              >
                Here's what's happening with your clients today
              </motion.p>
            </div>
          </div>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Active Clients"
            value={24}
            icon={Users}
            trend={{ value: "+3 this month", positive: true }}
            chart={[12, 15, 18, 20, 22, 24]}
            delay={0.1}
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
            delay={0.2}
          />
          <MetricCard title="Unread Messages" value={7} icon={MessageSquare} chart={[12, 10, 8, 9, 8, 7]} delay={0.3} />
          <MetricCard title="Upcoming Calls" value={5} icon={PhoneCall} chart={[3, 4, 6, 5, 4, 5]} delay={0.4} />
        </div>

        <CoachTipCard />

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent Check-ins */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.3 }}
            className="rounded-lg glass-card shadow-custom-md p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Recent Check-ins</h2>
              <motion.div
                whileHover={{ scale: 1.1 }}
                transition={{ duration: 0.15 }}
                className="flex h-9 w-9 items-center justify-center rounded-xs bg-success/10"
              >
                <TrendingUp className="h-4 w-4 text-success" />
              </motion.div>
            </div>
            <div className="space-y-4">
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
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 + i * 0.05, duration: 0.2 }}
                        whileHover={{ scale: 1.01, transition: { duration: 0.15 } }}
                        className="group flex items-center justify-between rounded-lg p-3 transition-all duration-150 hover:bg-muted/50 cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <motion.div
                            whileHover={{ scale: 1.05 }}
                            transition={{ duration: 0.15 }}
                            className="flex h-10 w-10 items-center justify-center rounded-xs bg-primary/10 text-primary text-sm font-medium"
                          >
                            {checkIn.clientAvatar ? (
                              <img
                                src={checkIn.clientAvatar}
                                alt={checkIn.clientName}
                                className="h-full w-full rounded-xs object-cover"
                              />
                            ) : (
                              initials
                            )}
                          </motion.div>
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
                      </motion.div>
                    </Link>
                  )
                })
              )}
            </div>
          </motion.div>

          {/* Upcoming Calls */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.3 }}
            className="rounded-lg glass-card shadow-custom-md p-6"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">Upcoming Calls</h2>
              <motion.div
                whileHover={{ scale: 1.1 }}
                transition={{ duration: 0.15 }}
                className="flex h-9 w-9 items-center justify-center rounded-xs bg-primary/10"
              >
                <PhoneCall className="h-4 w-4 text-primary" />
              </motion.div>
            </div>
            <div className="space-y-4">
              {[
                { name: "Lisa Anderson", time: "Today at 2:00 PM", type: "Initial Consultation", avatar: "LA" },
                { name: "Tom Martinez", time: "Today at 4:30 PM", type: "Progress Review", avatar: "TM" },
                { name: "Anna Taylor", time: "Tomorrow at 10:00 AM", type: "Program Planning", avatar: "AT" },
                { name: "David Brown", time: "Tomorrow at 3:00 PM", type: "Check-in Call", avatar: "DB" },
              ].map((call, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.05, duration: 0.2 }}
                  whileHover={{ scale: 1.01, transition: { duration: 0.15 } }}
                  className="group flex items-start gap-3 rounded-lg p-3 transition-all duration-150 hover:bg-muted/50"
                >
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    transition={{ duration: 0.15 }}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xs bg-secondary/10 text-secondary text-sm font-medium"
                  >
                    {call.avatar}
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{call.name}</p>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                      <Clock className="h-3 w-3" />
                      {call.time}
                    </div>
                    <p className="text-xs text-primary font-medium mt-1">{call.type}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      <FloatingActionButton />
    </AppLayout>
  )
}
