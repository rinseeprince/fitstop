"use client"

import { useState } from "react"
import { AppLayout } from "@/components/app-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { AutomationRuleCard } from "@/components/automation-rule-card"
import { Plus, Zap } from "lucide-react"
import type { AutomationRule } from "@/types/automation"

const inputClass = "border-[rgba(13,148,136,0.08)] rounded-[6px] text-[#0c1a1e] placeholder:text-[#93b0b4] focus:border-[#0d9488] focus:ring-[#0d9488]/20"
const labelClass = "text-[12px] font-medium text-[#0c1a1e]"

const mockRules: AutomationRule[] = [
  {
    id: "1",
    name: "Welcome Email for New Clients",
    trigger: {
      type: "Client Added",
      description: "When a new client is added to the system",
    },
    action: {
      type: "Send Email",
      description: "Send welcome email with onboarding information",
    },
    isActive: true,
    createdAt: new Date("2024-01-15"),
  },
  {
    id: "2",
    name: "Check-in Reminder",
    trigger: {
      type: "Weekly Schedule",
      description: "Every Sunday at 9:00 AM",
    },
    action: {
      type: "Send Check-in Link",
      description: "Send weekly check-in form to active clients",
    },
    isActive: true,
    createdAt: new Date("2024-01-20"),
  },
  {
    id: "3",
    name: "Call Booking Confirmation",
    trigger: {
      type: "Call Booked",
      description: "When a discovery call is scheduled",
    },
    action: {
      type: "Send Confirmation",
      description: "Send calendar invite and preparation guide",
    },
    isActive: false,
    createdAt: new Date("2024-02-01"),
  },
]

interface StatCardProps {
  label: string
  value: string | number
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="bg-white rounded-[6px] p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[rgba(13,148,136,0.08)]">
          <Zap className="h-5 w-5 text-[#0d9488]" strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4]">
            {label}
          </p>
          <p className="text-[24px] font-bold font-mono-display text-[#0c1a1e] leading-tight tracking-[-0.02em]">
            {value}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function AutomationPage() {
  const [rules, setRules] = useState<AutomationRule[]>(mockRules)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const handleToggle = (id: string, isActive: boolean) => {
    setRules((prevRules) => prevRules.map((rule) => (rule.id === id ? { ...rule, isActive } : rule)))
  }

  const createAutomationButton = (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-[6px] text-[#5a7d82] hover:text-[#0c1a1e] hover:bg-[rgba(0,0,0,0.02)] transition-all"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          <span className="sr-only">Create Automation</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Automation</DialogTitle>
          <DialogDescription>Set up an if-this-then-that workflow</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label className={labelClass}>Automation Name</Label>
            <Input placeholder="e.g., Send welcome email to new leads" className={inputClass} />
          </div>

          <div className="space-y-3">
            <Label className={labelClass}>When (Trigger)</Label>
            <Select>
              <SelectTrigger className={inputClass}>
                <SelectValue placeholder="Select a trigger" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client-added">Client is added</SelectItem>
                <SelectItem value="call-booked">Call is booked</SelectItem>
                <SelectItem value="checkin-submitted">Check-in is submitted</SelectItem>
                <SelectItem value="weekly">Weekly schedule</SelectItem>
                <SelectItem value="monthly">Monthly schedule</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label className={labelClass}>Then (Action)</Label>
            <Select>
              <SelectTrigger className={inputClass}>
                <SelectValue placeholder="Select an action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="send-email">Send email</SelectItem>
                <SelectItem value="send-sms">Send SMS</SelectItem>
                <SelectItem value="send-checkin">Send check-in link</SelectItem>
                <SelectItem value="add-tag">Add client tag</SelectItem>
                <SelectItem value="move-stage">Move to CRM stage</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setIsDialogOpen(false)}
            className="border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:bg-[rgba(0,0,0,0.02)]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => setIsDialogOpen(false)}
            className="bg-[#0d9488] hover:bg-[#0d9488]/90 text-white"
          >
            Create Automation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  const pageHeader = (
    <PageHeader
      title="Automation"
      description="Set up automated workflows to save time"
    />
  )

  return (
    <AppLayout pageHeader={pageHeader} headerActions={createAutomationButton}>
      <div className="space-y-6">
        {/* Quick Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total Automations" value={rules.length} />
          <StatCard label="Active Rules" value={rules.filter((r) => r.isActive).length} />
          <StatCard label="Runs This Month" value={247} />
        </div>

        {/* Automation Rules */}
        <div>
          <h2 className="text-[20px] font-bold tracking-tight text-[#0c1a1e] mb-4">Your Automations</h2>
          <div className="space-y-4">
            {rules.map((rule) => (
              <AutomationRuleCard key={rule.id} rule={rule} onToggle={handleToggle} />
            ))}
          </div>
        </div>

        {/* Template Gallery */}
        <div className="bg-white rounded-[6px]">
          <div className="px-5 py-4 border-b border-[rgba(13,148,136,0.08)] flex items-center justify-between min-h-[64px]">
            <h3 className="text-[15px] font-semibold tracking-tight text-[#0c1a1e]">Automation Templates</h3>
            <span className="text-[11px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">Quick-start templates for common workflows</span>
          </div>
          <div className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                {
                  title: "Lead Nurture Sequence",
                  description: "Automatically send follow-up emails to new leads over 7 days",
                },
                {
                  title: "Birthday Greetings",
                  description: "Send personalized birthday messages to your clients",
                },
                {
                  title: "Program Completion",
                  description: "Celebrate client milestones and request testimonials",
                },
                {
                  title: "Inactive Client Re-engagement",
                  description: "Reach out to clients who haven't checked in for 30 days",
                },
              ].map((template, i) => (
                <div key={i} className="p-4 rounded-[6px] border border-[rgba(13,148,136,0.08)]">
                  <h3 className="font-medium mb-1 text-[#0c1a1e]">{template.title}</h3>
                  <p className="text-sm text-[#5a7d82] mb-3">{template.description}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:bg-[rgba(0,0,0,0.02)]"
                  >
                    Use Template
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
