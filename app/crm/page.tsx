"use client"

import type React from "react"

import { useState } from "react"
import { AppLayout } from "@/components/app-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { LeadCard } from "@/components/lead-card"
import { Plus } from "lucide-react"
import type { Lead, KanbanColumn } from "@/types/crm"

const initialColumns: KanbanColumn[] = [
  {
    id: "cold",
    title: "Cold Lead",
    stage: "cold",
    leads: [
      {
        id: "1",
        name: "John Smith",
        email: "john@email.com",
        source: "Instagram",
        notes: "Interested in strength training",
        stage: "cold",
      },
      {
        id: "2",
        name: "Mary Johnson",
        email: "mary@email.com",
        source: "Referral",
        notes: "Looking for nutrition coaching",
        stage: "cold",
      },
    ],
  },
  {
    id: "warm",
    title: "Warm Lead",
    stage: "warm",
    leads: [
      {
        id: "3",
        name: "Alex Brown",
        email: "alex@email.com",
        source: "Website",
        notes: "Responded to initial email",
        stage: "warm",
      },
      {
        id: "4",
        name: "Lisa Davis",
        email: "lisa@email.com",
        source: "Facebook",
        notes: "Asked about pricing",
        stage: "warm",
      },
    ],
  },
  {
    id: "booked",
    title: "Call Booked",
    stage: "booked",
    leads: [
      {
        id: "5",
        name: "Tom Wilson",
        email: "tom@email.com",
        source: "Instagram",
        notes: "Discovery call scheduled for Thursday",
        stage: "booked",
      },
    ],
  },
  {
    id: "client",
    title: "Client",
    stage: "client",
    leads: [
      {
        id: "6",
        name: "Emma Taylor",
        email: "emma@email.com",
        source: "Referral",
        notes: "Onboarded last week",
        stage: "client",
      },
      {
        id: "7",
        name: "David Martinez",
        email: "david@email.com",
        source: "Website",
        notes: "Starting this Monday",
        stage: "client",
      },
    ],
  },
]

export default function CRMPage() {
  const [columns, setColumns] = useState<KanbanColumn[]>(initialColumns)
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [newLead, setNewLead] = useState({
    name: "",
    email: "",
    source: "",
    notes: "",
  })

  const handleDragStart = (e: React.DragEvent, lead: Lead) => {
    setDraggedLead(lead)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent, targetStage: Lead["stage"]) => {
    e.preventDefault()

    if (!draggedLead) return

    setColumns((prevColumns) => {
      const newColumns = prevColumns.map((column) => {
        // Remove lead from source column
        if (column.stage === draggedLead.stage) {
          return {
            ...column,
            leads: column.leads.filter((lead) => lead.id !== draggedLead.id),
          }
        }
        // Add lead to target column
        if (column.stage === targetStage) {
          return {
            ...column,
            leads: [...column.leads, { ...draggedLead, stage: targetStage }],
          }
        }
        return column
      })
      return newColumns
    })

    setDraggedLead(null)
  }

  const handleAddLead = () => {
    if (!newLead.name || !newLead.email) return

    const lead: Lead = {
      id: Date.now().toString(),
      ...newLead,
      stage: "cold",
    }

    setColumns((prevColumns) =>
      prevColumns.map((column) => (column.stage === "cold" ? { ...column, leads: [...column.leads, lead] } : column)),
    )

    setNewLead({ name: "", email: "", source: "", notes: "" })
    setIsDialogOpen(false)
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">CRM Pipeline</h1>
            <p className="text-muted-foreground mt-1">Track leads through your sales funnel</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add New Lead
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Lead</DialogTitle>
                <DialogDescription>
                  Enter the details for your new lead. They will be added to the Cold Lead column.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="John Doe"
                    value={newLead.name}
                    onChange={(e) => setNewLead({ ...newLead, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="john@example.com"
                    value={newLead.email}
                    onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="source">Source</Label>
                  <Input
                    id="source"
                    placeholder="Instagram, Website, Referral..."
                    value={newLead.source}
                    onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Add any relevant notes..."
                    value={newLead.notes}
                    onChange={(e) => setNewLead({ ...newLead, notes: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddLead}>Add Lead</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Kanban Board */}
        <div className="grid gap-4 lg:grid-cols-4">
          {columns.map((column) => (
            <Card
              key={column.id}
              className="flex flex-col"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.stage)}
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{column.title}</span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {column.leads.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                {column.leads.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    No leads yet
                  </div>
                ) : (
                  column.leads.map((lead) => <LeadCard key={lead.id} lead={lead} onDragStart={handleDragStart} />)
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Stats Summary */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {columns.map((column) => (
            <Card key={`stat-${column.id}`}>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">{column.title}</p>
                  <p className="mt-2 text-3xl font-bold">{column.leads.length}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
