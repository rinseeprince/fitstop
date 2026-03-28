"use client"

import Link from "next/link"
import { ArrowLeft, UserPlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { InviteClientDialog } from "@/components/clients/invite-client-dialog"
import { NotificationsDropdown } from "@/components/navbar/notifications-dropdown"
import { cn } from "@/lib/utils"
import type { OnboardingStatus } from "@/types/client-intake"

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "roadmap", label: "Roadmap" },
  { value: "metrics", label: "Metrics" },
  { value: "training", label: "Training" },
  { value: "nutrition", label: "Nutrition" },
  { value: "wellness", label: "Wellness" },
  { value: "daily-habits", label: "Habits" },
  { value: "notes", label: "Notes" },
] as const

export type ClientTab = (typeof TABS)[number]["value"]

interface ClientPageHeaderProps {
  client: {
    id: string
    name: string
    email: string
    onboardingStatus?: OnboardingStatus
  }
  activeTab: ClientTab
  onTabChange: (tab: ClientTab) => void
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
}

export function ClientPageHeader({
  client,
  activeTab,
  onTabChange,
}: ClientPageHeaderProps) {
  return (
    <div>
      {/* Row 1: Back + Avatar + Name + Invite + Notifications */}
      <div className="flex items-center gap-3 px-6 lg:px-8 pt-4 pb-3">
        {/* Back button */}
        <Link
          href="/clients"
          className="text-[#93b0b4] hover:text-[#5a7d82] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        {/* Avatar — square with gradient */}
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] text-[11px] font-bold text-white flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
        >
          {getInitials(client.name)}
        </div>

        {/* Name + onboarding badge */}
        <h1 className="text-[15px] font-semibold text-[#0c1a1e]">{client.name}</h1>
        {client.onboardingStatus === "pending_intake" && (
          <Badge variant="warning">Awaiting Intake</Badge>
        )}
        {client.onboardingStatus === "intake_completed" && (
          <Link href={`/clients/${client.id}/intake-review`}>
            <Badge variant="default" className="cursor-pointer">Intake Ready for Review</Badge>
          </Link>
        )}
        {client.onboardingStatus === "setup_in_progress" && (
          <Badge variant="default">Setting Up Plans</Badge>
        )}
        {client.onboardingStatus === "paused" && (
          <Badge variant="secondary">Paused</Badge>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons + notifications */}
        <div className="flex items-center gap-3">
          <InviteClientDialog
            client={client}
            trigger={
              <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-[#5a7d82] bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] hover:bg-[#f0f5f4] transition-colors">
                <UserPlus className="h-3.5 w-3.5" />
                Invite
              </button>
            }
          />
          <NotificationsDropdown />
        </div>
      </div>

      {/* Row 2: Tab navigation */}
      <div className="flex gap-0 px-6 lg:px-8">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            className={cn(
              "px-[14px] py-[9px] text-[14px] transition-colors duration-150 ease-in-out border-b-2",
              activeTab === tab.value
                ? "font-semibold text-[#0c1a1e] border-[#0d9488]"
                : "font-normal text-[#6b8a8e] border-transparent hover:text-[#5a7d82]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}
