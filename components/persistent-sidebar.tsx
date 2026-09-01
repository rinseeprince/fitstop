"use client"

import { SidebarNav } from "./sidebar-nav"
import { User, LogOut, ChevronDown } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/hooks/use-toast"

/**
 * The full 80px coach rail. Mounted by AppLayout — the shell decides that a
 * surface gets this rail rather than the 52px CollapsedIconStrip, and the
 * app/(coach)/ boundary plus middleware decide that the viewer is a coach — so
 * this component decides nothing: no route classification, no role check, no
 * wait on auth. It renders on first paint. Only the footer's name and email are
 * user data, and they fill in when the profile resolves.
 */
export function PersistentSidebar() {
  const { coach, logout, loading } = useAuth()
  const router = useRouter()
  const { toast } = useToast()

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
        <div
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[13px] font-bold text-white"
          style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
        >
          CH
        </div>
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
