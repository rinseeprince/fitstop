"use client"

import Link from "next/link"
import { ArrowLeft, MessageSquare, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SendCheckInDialog } from "@/components/check-in/send-check-in-dialog"
import { InviteClientDialog } from "@/components/clients/invite-client-dialog"
import { cn } from "@/lib/utils"
import type { OnboardingStatus } from "@/types/client-intake"

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "metrics", label: "Metrics" },
  { value: "training", label: "Training Plan" },
  { value: "nutrition", label: "Nutrition" },
  { value: "daily-habits", label: "Daily Habits" },
  { value: "notes", label: "Notes & Messages" },
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
    <div className="flex items-center gap-4 px-6 lg:px-8 h-[72px]">
      {/* Back button */}
      <Link
        href="/clients"
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>

      {/* Avatar */}
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary flex-shrink-0">
        {getInitials(client.name)}
      </div>

      {/* Name + onboarding badge */}
      <h1 className="text-lg font-semibold">{client.name}</h1>
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

      {/* Tabs - inline */}
      <div className="flex gap-1 ml-4">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onTabChange(tab.value)}
            className={cn(
              "px-3 py-1.5 text-sm font-medium transition-colors",
              activeTab === tab.value
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Action buttons */}
      <div className="flex items-center gap-2 pr-20">
        <InviteClientDialog
          client={client}
          trigger={
            <Button variant="outline" size="sm">
              <UserPlus className="h-4 w-4 mr-2" />
              Invite
            </Button>
          }
        />

        <SendCheckInDialog
          clientId={client.id}
          clientName={client.name}
          clientEmail={client.email}
          trigger={
            <Button size="sm">
              <MessageSquare className="h-4 w-4 mr-2" />
              Send Check-In
            </Button>
          }
        />
      </div>
    </div>
  )
}
