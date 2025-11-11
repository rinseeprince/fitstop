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
            (ci: any) => ci.status === "ai_processed"
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
    <nav className="flex flex-col gap-2">
      {navigation.map((item, index) => {
        const isActive = pathname === item.href
        return (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Link
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-xs px-4 py-3 text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="activeNav"
                  className="absolute inset-0 rounded-xs bg-primary/10"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
              <item.icon
                className={cn(
                  "relative h-5 w-5 transition-transform duration-150",
                  isActive && "scale-105",
                )}
              />
              <span className="relative">{item.name}</span>
              {item.showBadge && unreviewedCount > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="relative ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium"
                >
                  {unreviewedCount}
                </motion.span>
              )}
            </Link>
          </motion.div>
        )
      })}
    </nav>
  )
}
