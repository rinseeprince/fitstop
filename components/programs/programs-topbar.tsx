"use client"

import { usePathname } from "next/navigation"
import { NotificationsDropdown } from "@/components/navbar/notifications-dropdown"
import { getProgramsView, type ProgramsView } from "@/lib/programs-nav"

// Per-view sticky topbar for the Programs section: title + notifications.
// Create actions live on each page's library-divider "+" (roadmap divider
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
  const title = VIEW_TITLES[getProgramsView(pathname)]

  return (
    <header className="sticky top-0 z-10 bg-white px-8 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-bold text-[#0c1a1e]">{title}</h1>
        <NotificationsDropdown compact />
      </div>
    </header>
  )
}
