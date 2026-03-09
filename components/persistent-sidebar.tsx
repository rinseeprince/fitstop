"use client"

import { SidebarNav } from "./sidebar-nav"
import { User, LogOut, ChevronDown } from "lucide-react"
import { motion } from "framer-motion"
import { useAuth } from "@/contexts/auth-context"
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
  "/check-in/",
  "/client/",
  "/client",
]

export function PersistentSidebar() {
  const { coach, logout, loading, isClient, isTrainer, role } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useToast()


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
    <aside className="hidden lg:flex w-20 flex-col border-r border-primary-foreground/10 bg-primary fixed inset-y-0 left-0 z-20">
      <div className="flex h-[72px] items-center justify-center border-b border-primary-foreground/10">
        <motion.h1
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-lg font-semibold text-primary-foreground"
        >
          CH
        </motion.h1>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <SidebarNav />
      </div>

      <div className="border-t border-white/10 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex flex-col items-center justify-center w-full rounded-lg p-3 transition-all duration-150 hover:bg-white/10 text-white/70 hover:text-white">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white">
                <User className="h-4 w-4" />
              </div>
              <ChevronDown className="h-3 w-3 mt-1" />
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
