"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LABEL_CLASS, MONO } from "@/components/clients/training/program-builder/builder-tokens"
import { motion } from "framer-motion"
import { useClientAttentionCount } from "@/hooks/use-client-attention"
import { navigation } from "@/lib/navigation"

export function SidebarNav() {
  const pathname = usePathname()
  const [optimisticHref, setOptimisticHref] = useState<string | null>(null)
  const attentionCount = useClientAttentionCount()

  // Reset optimistic state when pathname catches up
  useEffect(() => {
    if (optimisticHref && pathname === optimisticHref) {
      setOptimisticHref(null)
    }
  }, [pathname, optimisticHref])

  return (
    <nav className="flex flex-col gap-1">
      {navigation.map((item) => {
        // Exact match for dashboard, startsWith for other routes
        const isActiveByPath = item.href === "/dashboard"
          ? pathname === "/dashboard"
          : pathname?.startsWith(item.href)
        // Use optimistic state for immediate feedback, fall back to pathname
        const isActive = optimisticHref ? item.href === optimisticHref : isActiveByPath
        return (
          <div key={item.name}>
            <Link
              href={item.href}
              onClick={() => setOptimisticHref(item.href)}
              className={cn(
                "group relative flex flex-col items-center justify-center rounded-[6px] px-2 py-3 text-xs font-medium transition-all duration-150",
                isActive
                  ? "text-[#0d9488]"
                  : "text-[rgba(255,255,255,0.45)] hover:text-white hover:bg-[rgba(255,255,255,0.05)]",
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="activeNav"
                  className="absolute inset-0 rounded-[6px] bg-[rgba(13,148,136,0.15)]"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
              <div className="relative">
                <item.icon
                  strokeWidth={1.5}
                  className={cn(
                    "relative h-5 w-5 transition-transform duration-150",
                    isActive && "scale-105",
                  )}
                />
                {item.showBadge && attentionCount > 0 && (
                  <span
                    className={cn(MONO, "absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#0d9488] text-white text-[10px] font-medium")}
                  >
                    {attentionCount > 9 ? "9+" : attentionCount}
                  </span>
                )}
              </div>
              <span className="relative mt-1 text-[10px] text-center leading-tight">{item.name}</span>
              {item.beta && (
                <span className={cn(LABEL_CLASS, "relative mt-0.5 text-[8px] font-semibold px-1.5 py-[1px] rounded-[4px] bg-[rgba(13,148,136,0.15)] text-[#0d9488]")}>
                  Beta
                </span>
              )}
            </Link>
          </div>
        )
      })}
    </nav>
  )
}
