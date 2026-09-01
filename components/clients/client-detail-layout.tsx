"use client"

import type { ReactNode } from "react"
import { Loader2, UserPlus } from "lucide-react"
import { CollapsedIconStrip } from "@/components/collapsed-icon-strip"
import { ClientSidebar } from "@/components/clients/client-sidebar"
import { InviteClientDialog } from "@/components/clients/invite-client-dialog"
import { PinIntakeButton } from "@/components/coach/pin-intake-button"
import { NotificationsDropdown } from "@/components/navbar/notifications-dropdown"
import { CLIENT_TABS, type ClientTab } from "@/lib/client-tabs"
import type { OnboardingStatus } from "@/types/client-intake"

interface ClientDetailLayoutProps {
  client: {
    id: string
    name: string
    email: string
    onboardingStatus?: OnboardingStatus
  }
  activeTab: ClientTab
  onTabChange: (tab: ClientTab) => void
  children: ReactNode
  isLoading?: boolean
}

function getPageTitle(tab: ClientTab): string {
  const found = CLIENT_TABS.find((t) => t.value === tab)
  return found?.label ?? "Overview"
}

export function ClientDetailLayout({
  client,
  activeTab,
  onTabChange,
  children,
  isLoading,
}: ClientDetailLayoutProps) {
  return (
    // The frame is never gated on the client record, and nothing here may
    // introduce an opacity, `hidden` or Suspense gate that would put it behind
    // one. The tab list, the page title and the back link are all derivable
    // from the URL, so they paint immediately; the record fills the two
    // client-specific slots — the sidebar's name/avatar, the intake pin — when
    // it lands, and ClientSidebar already ships the pending treatment for that
    // window. Navigation is the reason this is a rule and not a preference: a
    // gate here takes the client's own tab list down with the content — and,
    // since this shell mounts the application rail too, the rail with it.
    <div className="flex min-h-screen bg-background">
      {/* The 52px application rail: this shell's, mounted beside the column
          and outside the loading branch below. */}
      <CollapsedIconStrip />
      <ClientSidebar
        client={client}
        activeTab={activeTab}
        onTabChange={onTabChange}
      />

      {/* Main content area — offset by 52px icon strip + 200px client sidebar */}
      <div className="flex-1 flex flex-col lg:ml-[252px]">
        {/* Page header — generic: title + invite + notifications */}
        <header className="sticky top-0 z-10 bg-white px-8 py-2">
          <div className="flex items-center justify-between">
            <h1 className="text-[15px] font-bold text-[#0c1a1e]">
              {getPageTitle(activeTab)}
            </h1>

            <div className="flex items-center gap-2.5">
              <PinIntakeButton clientId={client.id} clientName={client.name} onboardingStatus={client.onboardingStatus} />
              <InviteClientDialog
                client={client}
                trigger={
                  <button className="relative text-[#93b0b4] hover:text-[#5a7d82] transition-colors p-1">
                    <UserPlus className="h-[15px] w-[15px]" />
                  </button>
                }
              />
              <NotificationsDropdown compact />
            </div>
          </div>
        </header>

        {/* Page content. The record decides only what fills the main column,
            never whether the frame exists — the tab's own reads then show
            their own loading state on top of this one. */}
        <main className="flex-1 overflow-y-auto bg-[#f4f7f6] px-8 py-5 pb-[60px]">
          {isLoading ? (
            <div role="status" className="flex flex-col items-center justify-center gap-3 py-24">
              <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" strokeWidth={1.5} />
              <p className="text-[13px] text-[#93b0b4]">Loading client…</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  )
}
