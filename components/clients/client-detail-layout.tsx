"use client"

import type { ReactNode } from "react"
import { UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
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
    <div className={cn(
      "flex min-h-screen bg-background transition-opacity duration-300 ease-in-out",
      isLoading ? "opacity-0" : "opacity-100"
    )}>
      {/* Client sidebar (icon strip is rendered by PersistentSidebar in root layout) */}
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

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-[#f4f7f6] px-8 py-5 pb-[60px]">
          {children}
        </main>
      </div>
    </div>
  )
}
