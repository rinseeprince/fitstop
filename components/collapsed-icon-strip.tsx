"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { User, LogOut, ChevronDown } from "lucide-react"
import { motion } from "framer-motion"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/hooks/use-toast"
import { navigation } from "@/lib/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function CollapsedIconStrip() {
  const pathname = usePathname()
  const router = useRouter()
  const { coach, logout, loading, isTrainer } = useAuth()
  const { toast } = useToast()
  const [unreviewedCount, setUnreviewedCount] = useState(0)
  const [optimisticHref, setOptimisticHref] = useState<string | null>(null)

  useEffect(() => {
    if (optimisticHref && pathname === optimisticHref) {
      setOptimisticHref(null)
    }
  }, [pathname, optimisticHref])

  useEffect(() => {
    if (!isTrainer) return

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
    const interval = setInterval(() => void fetchUnreviewedCount(), 60000)
    return () => clearInterval(interval)
  }, [isTrainer])

  const handleLogout = async () => {
    try {
      await logout()
      toast({
        title: "Logged out successfully",
        description: "See you next time!",
      })
      router.push("/login")
    } catch {
      toast({
        title: "Error",
        description: "Failed to log out",
        variant: "destructive",
      })
    }
  }

  return (
    <aside className="hidden lg:flex w-[52px] flex-col bg-[#0f2027] fixed inset-y-0 left-0 z-20">
      {/* Logo */}
      <div className="flex h-[52px] items-center justify-center">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[11px] font-bold text-white"
          style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
        >
          CH
        </div>
      </div>

      {/* Nav icons */}
      <nav className="flex-1 flex flex-col items-center gap-1 px-2 pt-2">
        {navigation.map((item) => {
          const isActiveByPath = item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname?.startsWith(item.href)
          const isActive = optimisticHref ? item.href === optimisticHref : isActiveByPath

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => setOptimisticHref(item.href)}
              title={item.name}
              className={cn(
                "relative flex items-center justify-center w-9 h-9 rounded-[6px] transition-colors duration-150",
                isActive
                  ? "bg-[rgba(13,148,136,0.15)]"
                  : "bg-transparent hover:bg-[rgba(255,255,255,0.05)]"
              )}
            >
              <item.icon
                className={cn(
                  "h-[18px] w-[18px]",
                  isActive
                    ? "text-[#0d9488]"
                    : "text-[rgba(255,255,255,0.35)]"
                )}
              />
              {item.showBadge && unreviewedCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#0d9488] text-white text-[8px] font-medium">
                  {unreviewedCount > 9 ? "9+" : unreviewedCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* User dropdown */}
      <div className="p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center justify-center w-9 h-9 mx-auto rounded-[6px] transition-colors duration-150 hover:bg-[rgba(255,255,255,0.05)]">
              <User className="h-[18px] w-[18px] text-[rgba(255,255,255,0.35)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="right" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{loading ? "Loading..." : coach?.name || "Coach"}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {loading ? "" : coach?.email || ""}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <User className="h-4 w-4 mr-2" />
              Profile Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
