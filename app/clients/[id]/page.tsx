"use client"

import { useState } from "react"
import { AppLayout } from "@/components/app-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ClientStatusBadge } from "@/components/client-status-badge"
import { SendCheckInDialog } from "@/components/check-in/send-check-in-dialog"
import { CheckInTimeline } from "@/components/check-in/check-in-timeline"
import { CheckInDetailModal } from "@/components/check-in/check-in-detail-modal"
import { ProgressCharts } from "@/components/check-in/progress-charts"
import { PhotoComparison } from "@/components/check-in/photo-comparison"
import { useCheckInData } from "@/hooks/use-check-in-data"
import { ArrowLeft, MessageSquare, Phone, Mail } from "lucide-react"
import Link from "next/link"

export default function ClientProfilePage() {
  // TODO: Get client ID from params
  const clientId = "client-1";
  const { checkIns, isLoading } = useCheckInData(clientId);
  const [selectedCheckInId, setSelectedCheckInId] = useState<string | null>(null);

  const handleSelectCheckIn = (checkInId: string) => {
    setSelectedCheckInId(checkInId);
  };

  const handleNavigate = (direction: "prev" | "next") => {
    if (!selectedCheckInId) return;

    const currentIndex = checkIns.findIndex((ci) => ci.id === selectedCheckInId);
    if (currentIndex === -1) return;

    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < checkIns.length) {
      setSelectedCheckInId(checkIns[newIndex].id);
    }
  };

  const selectedIndex = selectedCheckInId
    ? checkIns.findIndex((ci) => ci.id === selectedCheckInId)
    : -1;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Back Button */}
        <Button variant="ghost" asChild>
          <Link href="/clients">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Clients
          </Link>
        </Button>

        {/* Client Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
              SJ
            </div>
            <div>
              <h1 className="text-3xl font-bold">Sarah Johnson</h1>
              <p className="text-muted-foreground mt-1">Joined 3 months ago</p>
              <div className="mt-2">
                <ClientStatusBadge status="active" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <SendCheckInDialog
              clientId={clientId}
              clientName="Sarah Johnson"
              clientEmail="sarah.johnson@email.com"
            />
            <Button variant="outline">
              <MessageSquare className="h-4 w-4 mr-2" />
              Message
            </Button>
            <Button variant="outline">
              <Phone className="h-4 w-4 mr-2" />
              Call
            </Button>
          </div>
        </div>

        {/* Client Tabs */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="training">Training Plan</TabsTrigger>
            <TabsTrigger value="nutrition">Nutrition & Habits</TabsTrigger>
            <TabsTrigger value="content">Content Access</TabsTrigger>
            <TabsTrigger value="notes">Notes & Messages</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Contact Info */}
            <Card>
              <CardHeader>
                <CardTitle>Contact Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Email</p>
                      <p className="font-medium">sarah.johnson@email.com</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Phone className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Phone</p>
                      <p className="font-medium">+1 (555) 123-4567</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Progress Charts */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Progress Tracking</h3>
              <ProgressCharts checkIns={checkIns} />
            </div>

            {/* Progress Photos */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Progress Photos</h3>
              <PhotoComparison checkIns={checkIns} />
            </div>

            {/* Check-in History */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Check-In History</h3>
              <CheckInTimeline
                checkIns={checkIns}
                onSelectCheckIn={handleSelectCheckIn}
              />
            </div>
          </TabsContent>

          {/* Check-In Detail Modal */}
          <CheckInDetailModal
            checkInId={selectedCheckInId}
            clientId={clientId}
            onClose={() => setSelectedCheckInId(null)}
            onNavigate={handleNavigate}
            canNavigatePrev={selectedIndex > 0}
            canNavigateNext={selectedIndex < checkIns.length - 1 && selectedIndex !== -1}
          />

          {/* Training Plan Tab */}
          <TabsContent value="training" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Current Training Program</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { day: "Monday", workout: "Upper Body Strength", exercises: "5 exercises" },
                    { day: "Tuesday", workout: "Lower Body Strength", exercises: "6 exercises" },
                    { day: "Wednesday", workout: "Rest / Active Recovery", exercises: "Light cardio" },
                    { day: "Thursday", workout: "Push Day", exercises: "4 exercises" },
                    { day: "Friday", workout: "Pull Day", exercises: "5 exercises" },
                  ].map((day, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-lg border">
                      <div>
                        <p className="font-medium">{day.day}</p>
                        <p className="text-sm text-muted-foreground">{day.workout}</p>
                      </div>
                      <span className="text-sm text-muted-foreground">{day.exercises}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Nutrition Tab */}
          <TabsContent value="nutrition" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Nutrition Goals</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground mb-1">Daily Calories</p>
                    <p className="text-2xl font-bold">2,200</p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground mb-1">Protein</p>
                    <p className="text-2xl font-bold">165g</p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <p className="text-sm text-muted-foreground mb-1">Water</p>
                    <p className="text-2xl font-bold">3L</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Content Tab */}
          <TabsContent value="content" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Shared Resources</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { title: "Exercise Form Videos", date: "Shared 2 weeks ago" },
                    { title: "Meal Prep Guide", date: "Shared 1 month ago" },
                    { title: "Recovery Protocols", date: "Shared 1 month ago" },
                  ].map((resource, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-lg border">
                      <div>
                        <p className="font-medium">{resource.title}</p>
                        <p className="text-sm text-muted-foreground">{resource.date}</p>
                      </div>
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Coach Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    {
                      date: "3 days ago",
                      note: "Client is responding well to increased volume. Consider adding accessory work next cycle.",
                    },
                    {
                      date: "2 weeks ago",
                      note: "Discussed nutrition adjustments for better recovery. Client agreed to increase protein intake.",
                    },
                    { date: "1 month ago", note: "Initial assessment completed. Starting with foundation program." },
                  ].map((note, i) => (
                    <div key={i} className="p-4 rounded-lg border">
                      <p className="text-sm text-muted-foreground mb-2">{note.date}</p>
                      <p>{note.note}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
