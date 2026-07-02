"use client"

import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NotificationsDropdown } from "@/components/navbar/notifications-dropdown"
import { useToast } from "@/hooks/use-toast"
import { getProgramsView, type ProgramsView } from "@/lib/programs-nav"
import { DAYS_PER_WEEK } from "@/components/clients/training/program-builder/program-builder-types"

// Per-view sticky topbar for the Programs section: title + one contextual
// create action. "New program" owns its POST-then-navigate flow (moved from
// the old list page); "New session"/"New exercise" hand off to their pages
// via ?new=1 (the page opens its create flow and clears the param with
// router.replace — same URL-state pattern as /clients/[id]?tab=).
const VIEW_CONFIG: Record<ProgramsView, { title: string; action: string | null }> = {
  programs: { title: "Programs", action: "New program" },
  sessions: { title: "Sessions", action: "New session" },
  exercises: { title: "Exercise Library", action: "New exercise" },
  builder: { title: "Program Builder", action: null },
}

export function ProgramsTopbar() {
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const { toast } = useToast()
  const [isCreating, setIsCreating] = useState(false)

  const view = getProgramsView(pathname)
  const { title, action } = VIEW_CONFIG[view]

  const handleCreateProgram = async () => {
    setIsCreating(true)
    try {
      // A new program starts as one week of 7 rest days (empty === rest). The
      // create schema can't express weeks/set specs — the builder writes the
      // real structure through /overwrite on Save program.
      const res = await fetch("/api/training/saved-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled program",
          splitType: "custom",
          sessions: Array.from({ length: DAYS_PER_WEEK }, () => ({
            name: "Rest",
            isRest: true,
            exercises: [],
          })),
        }),
      })
      const data = (await res.json()) as { planId?: string; error?: string }
      if (!res.ok || !data.planId) {
        throw new Error(data.error ?? "Failed to create program")
      }
      router.push(`/dashboard/programs/${data.planId}`)
      // Leave the spinner on through the navigation — the builder replaces
      // this view.
    } catch {
      toast({
        title: "Error",
        description: "Failed to create program",
        variant: "destructive",
      })
      setIsCreating(false)
    }
  }

  const handleAction = () => {
    if (view === "programs") void handleCreateProgram()
    else if (view === "sessions") router.push("/dashboard/programs/sessions?new=1")
    else if (view === "exercises") router.push("/dashboard/programs/exercises?new=1")
  }

  return (
    <header className="sticky top-0 z-10 bg-white px-8 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-bold text-[#0c1a1e]">{title}</h1>

        <div className="flex items-center gap-2.5">
          {action && (
            <Button
              size="sm"
              onClick={handleAction}
              disabled={isCreating}
              className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            >
              {isCreating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
              )}
              {action}
            </Button>
          )}
          <NotificationsDropdown compact />
        </div>
      </div>
    </header>
  )
}
