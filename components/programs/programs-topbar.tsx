"use client"

import { usePathname } from "next/navigation"
import { NotificationsDropdown } from "@/components/navbar/notifications-dropdown"
import { getProgramsView, type ProgramsView } from "@/lib/programs-nav"

// Per-view sticky topbar for the Programs section: title + notifications.
// Create actions live on each page's library-divider "+" (divider-rail
// pattern) — programs-table owns the POST-then-navigate flow; the sessions/
// exercises pages open their create surfaces directly.
const VIEW_TITLES: Record<ProgramsView, string> = {
  programs: "Programs",
  sessions: "Sessions",
  exercises: "Exercise Library",
  builder: "Program Builder",
}

export function ProgramsTopbar() {
  const pathname = usePathname() ?? ""
  const view = getProgramsView(pathname)

  // The builder is full-bleed with its own dark program header (reference
  // layout) — no top strip there. The list / sessions / exercises pages keep
  // the topbar. ("Program Builder" now titles the builder's library panel.)
  if (view === "builder") return null

  const title = VIEW_TITLES[view]

  return (
    <header className="sticky top-0 z-10 bg-white px-8 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-bold text-[#0c1a1e]">{title}</h1>
        <NotificationsDropdown compact />
      </div>
    </header>
  )
}
