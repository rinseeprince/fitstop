"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Home, Users, KanbanSquare, MessageSquare, Zap, Mail, Settings } from "lucide-react"
import { motion } from "framer-motion"

const navigation = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Clients", href: "/clients", icon: Users, showBadge: true },
  { name: "CRM", href: "/crm", icon: KanbanSquare },
  { name: "Messages", href: "/messages", icon: MessageSquare },
  { name: "Automation", href: "/automation", icon: Zap },
  { name: "Email Marketing", href: "/email", icon: Mail },
  { name: "Settings", href: "/settings", icon: Settings },
]

export function SidebarNav() {
  const pathname = usePathname()
  const [unreviewedCount, setUnreviewedCount] = useState(0)

  useEffect(() => {
    const fetchUnreviewedCount = async () => {
      try {
        const response = await fetch("/api/check-ins/recent")
        if (response.ok) {
          const data = await response.json()
          const unreviewed = (data.checkIns || []).filter(
            (ci: { status: string }) => ci.status === "ai_processed"
          ).length
          setUnreviewedCount(unreviewed)
        }
      } catch (error) {
        console.error("Error fetching unreviewed count:", error)
      }
    }

    fetchUnreviewedCount()
    // Refresh every minute
    const interval = setInterval(fetchUnreviewedCount, 60000)
    return () => clearInterval(interval)
  }, [])

  return (
    <nav className="flex flex-col gap-1">
      {navigation.map((item, index) => {
        // Exact match for home, startsWith for other routes
        const isActive = item.href === "/"
          ? pathname === "/"
          : pathname?.startsWith(item.href)
        return (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Link
              href={item.href}
              className={cn(
                "group relative flex flex-col items-center justify-center rounded-lg px-2 py-3 text-xs font-medium transition-all duration-150",
                isActive
                  ? "bg-white/20 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/10",
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="activeNav"
                  className="absolute inset-0 rounded-lg bg-white/20"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
              <div className="relative">
                <item.icon
                  className={cn(
                    "relative h-5 w-5 transition-transform duration-150",
                    isActive && "scale-105",
                  )}
                />
                {item.showBadge && unreviewedCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-primary text-[10px] font-medium"
                  >
                    {unreviewedCount > 9 ? "9+" : unreviewedCount}
                  </motion.span>
                )}
              </div>
              <span className="relative mt-1 text-[10px] text-center leading-tight">{item.name}</span>
            </Link>
          </motion.div>
        )
      })}
    </nav>
  )
}
