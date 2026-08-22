"use client"

import type { ReactNode } from "react"
import { CheckInNotificationListener } from "@/components/check-in-notification-listener"
import { NotificationsDropdown } from "@/components/navbar/notifications-dropdown"
import { RosterSidebar } from "./roster-sidebar"
import {
  rosterViewLabel,
  type RosterCounts,
  type RosterView,
} from "@/lib/roster-views"

/**
 * The Clients section shell: the 52px icon strip (rendered globally by
 * PersistentSidebar), the 200px roster sidebar, and the main column — the same
 * three-column frame the client detail pages run, so the section and the pages
 * inside it stop being two different products.
 *
 * CheckInNotificationListener is re-mounted here for the same reason
 * ProgramsShell re-mounts it: these pages no longer render AppLayout, which
 * used to provide it.
 */
export function RosterShell({
  activeView,
  counts,
  onClientAdded,
  children,
}: {
  activeView: RosterView
  counts: RosterCounts
  onClientAdded: () => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <RosterSidebar
        activeView={activeView}
        counts={counts}
        onClientAdded={onClientAdded}
      />

      {/* min-w-0 + overflow-x-hidden are load-bearing: the table must scroll
          inside its own container, never the page (see ProgramsShell). */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-[252px]">
        <header className="sticky top-0 z-10 bg-white px-8 py-2">
          <div className="flex items-center justify-between">
            <h1 className="text-[15px] font-bold text-[#0c1a1e]">
              {rosterViewLabel(activeView)}
            </h1>

            {/* Title + notifications only, like ProgramsTopbar. Inviting lives
                on the sidebar footer, where the builder's library panel puts
                its create action — two always-visible mounts of the same
                dialog on one screen is one too many. */}
            <NotificationsDropdown compact />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-[#f4f7f6] px-8 py-5 pb-[60px]">
          {children}
        </main>
      </div>

      <CheckInNotificationListener />
    </div>
  )
}
