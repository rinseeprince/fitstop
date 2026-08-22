"use client"

import { SidebarNav } from "./sidebar-nav"
import { CollapsedIconStrip } from "./collapsed-icon-strip"
import { User, LogOut, ChevronDown } from "lucide-react"
import { motion } from "framer-motion"
import { useAuth } from "@/contexts/auth-context"
import { useTimezoneSync } from "@/hooks/use-timezone-sync"
import { useRouter, usePathname } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/hooks/use-toast"

// Pages that should NOT show the sidebar (auth pages, public pages, client portal, etc.)
const EXCLUDED_PATHS = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/client/",
  "/client",
]

export function PersistentSidebar() {
  const { coach, logout, loading, isClient, isTrainer, role } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useToast()

  // Keep the stored coach timezone in sync with the device (Session 7.81).
  // `coach` is only set for confirmed trainers, so this no-ops for everyone else.
  useTimezoneSync("coach", coach?.timezone)

  // Don't render sidebar on excluded paths
  // Use exact match for "/" and "/client" to avoid false positives:
  // - "/" would match all paths since every path starts with "/"
  // - "/client" would incorrectly match "/clients" (coach's client management page)
  const shouldHideSidebar = EXCLUDED_PATHS.some(path => {
    if (path === "/" || path === "/client") {
      return pathname === path
    }
    return pathname?.startsWith(path)
  })

  // Hide sidebar in these cases:
  // 1. On excluded paths
  // 2. For client users (role-based protection)
  // 3. While loading and we don't know the role yet
  if (shouldHideSidebar || isClient || (loading && !isTrainer)) {
    return null
  }

  // Extra safety: only show for confirmed trainers
  if (!loading && role !== "trainer") {
    return null
  }

  // On sectioned surfaces (the Clients roster, client detail, Programs) render
  // the collapsed 52px icon strip instead of the full sidebar — the section's
  // own white sub-sidebar sits beside it.
  // NOTE: The client-detail pattern assumes tab routing uses query params
  // (?tab=nutrition), not nested routes like /clients/[id]/nutrition.
  const COLLAPSED_SHELL_PATTERNS = [
    /^\/clients$/,
    /^\/clients\/[^/]+$/,
    /^\/dashboard\/programs(\/|$)/,
  ]
  if (COLLAPSED_SHELL_PATTERNS.some((pattern) => pattern.test(pathname || ""))) {
    return <CollapsedIconStrip />
  }

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
    <aside className="hidden lg:flex w-20 flex-col border-r border-[rgba(255,255,255,0.06)] bg-[#0f2027] fixed inset-y-0 left-0 z-20">
      <div className="flex h-[72px] items-center justify-center border-b border-[rgba(255,255,255,0.06)]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[13px] font-bold text-white"
          style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
        >
          CH
        </motion.div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <SidebarNav />
      </div>

      <div className="border-t border-[rgba(255,255,255,0.06)] p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex flex-col items-center justify-center w-full rounded-[6px] p-3 transition-all duration-150 hover:bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.55)] hover:text-white">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,0.08)] text-white">
                <User className="h-4 w-4" strokeWidth={1.5} />
              </div>
              <ChevronDown className="h-3 w-3 mt-1" strokeWidth={1.5} />
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
