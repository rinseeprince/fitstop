"use client"

import { useState } from "react"
import { AppLayout } from "@/components/app-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

export default function AutomationPage() {
  const [rules, setRules] = useState<AutomationRule[]>(mockRules)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const handleToggle = (id: string, isActive: boolean) => {
    setRules((prevRules) => prevRules.map((rule) => (rule.id === id ? { ...rule, isActive } : rule)))
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Automation</h1>
            <p className="text-muted-foreground mt-1">Set up automated workflows to save time</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Automation
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create New Automation</DialogTitle>
                <DialogDescription>Set up an if-this-then-that workflow</DialogDescription>
              </DialogHeader>
              <div className="space-y-6 py-4">
                <div className="space-y-2">
                  <Label>Automation Name</Label>
                  <Input placeholder="e.g., Send welcome email to new leads" />
                </div>

                <div className="space-y-3">
                  <Label>When (Trigger)</Label>
                  <Select>
                    <SelectTrigger>
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
                  <Label>Then (Action)</Label>
                  <Select>
                    <SelectTrigger>
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
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setIsDialogOpen(false)}>Create Automation</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Automations</p>
                  <p className="text-2xl font-bold">{rules.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <Zap className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Rules</p>
                  <p className="text-2xl font-bold">{rules.filter((r) => r.isActive).length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                  <Zap className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Runs This Month</p>
                  <p className="text-2xl font-bold">247</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Automation Rules */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Your Automations</h2>
          <div className="space-y-4">
            {rules.map((rule) => (
              <AutomationRuleCard key={rule.id} rule={rule} onToggle={handleToggle} />
            ))}
          </div>
        </div>

        {/* Template Gallery */}
        <Card>
          <CardHeader>
            <CardTitle>Automation Templates</CardTitle>
            <CardDescription>Quick-start templates for common workflows</CardDescription>
          </CardHeader>
          <CardContent>
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
                <div key={i} className="p-4 rounded-lg border">
                  <h3 className="font-medium mb-1">{template.title}</h3>
                  <p className="text-sm text-muted-foreground mb-3">{template.description}</p>
                  <Button variant="outline" size="sm">
                    Use Template
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
