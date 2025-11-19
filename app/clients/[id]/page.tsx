"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
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
import { CheckInScheduleCard } from "@/components/clients/check-in-schedule-card"
import { useCheckInData, useClient } from "@/hooks/use-check-in-data"
import { ArrowLeft, MessageSquare, Phone, Mail, Loader2, AlertCircle, Calculator } from "lucide-react"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"

export default function ClientProfilePage() {
  const params = useParams()
  const clientId = params.id as string
  const { toast } = useToast()

  const { client, isLoading: clientLoading, isError: clientError, mutate: mutateClient } = useClient(clientId)
  const { checkIns, isLoading: checkInsLoading } = useCheckInData(clientId)
  const [selectedCheckInId, setSelectedCheckInId] = useState<string | null>(null)
  const [isCalculatingBMR, setIsCalculatingBMR] = useState(false)

  const handleSelectCheckIn = (checkIn: any) => {
    setSelectedCheckInId(checkIn.id);
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

  // Helper to get client initials
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  // Helper to format joined date
  const formatJoinedDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const months = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    if (months < 1) return "Joined recently";
    if (months === 1) return "Joined 1 month ago";
    return `Joined ${months} months ago`;
  };

  // Handle BMR calculation
  const handleCalculateBMR = async () => {
    setIsCalculatingBMR(true);
    try {
      const response = await fetch(`/api/clients/${clientId}/calculate-bmr`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to calculate BMR");
      }

      toast({
        title: "BMR Calculated",
        description: `BMR: ${data.bmr} cal/day, TDEE: ${data.tdee} cal/day`,
      });

      // Refresh client data
      mutateClient();
    } catch (error) {
      toast({
        title: "Failed to calculate BMR",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsCalculatingBMR(false);
    }
  };

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

        {/* Loading State */}
        {clientLoading && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading client...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error State */}
        {clientError && !clientLoading && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <AlertCircle className="w-12 h-12 text-destructive" />
                <div className="text-center space-y-1">
                  <p className="font-medium">Failed to load client</p>
                  <p className="text-sm text-muted-foreground">
                    This client may not exist or you don&apos;t have permission to view it.
                  </p>
                </div>
                <Button asChild>
                  <Link href="/clients">Back to Clients</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Client Content */}
        {!clientLoading && !clientError && client && (
          <>
            {/* Client Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                  {getInitials(client.name)}
                </div>
                <div>
                  <h1 className="text-3xl font-bold">{client.name}</h1>
                  <p className="text-muted-foreground mt-1">
                    {formatJoinedDate(client.createdAt)}
                  </p>
                  <div className="mt-2">
                    <ClientStatusBadge status={client.active ? "active" : "inactive"} />
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <SendCheckInDialog
                  clientId={client.id}
                  clientName={client.name}
                  clientEmail={client.email}
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
            {/* Contact Info & Metrics */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Contact Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4">
                    <div className="flex items-center gap-3">
                      <Mail className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Email</p>
                        <p className="font-medium">{client.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Phone className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm text-muted-foreground">Phone</p>
                        <p className="font-medium text-muted-foreground">Not provided</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                  <CardTitle>Current Metrics</CardTitle>
                  {(!client.bmr || !client.tdee) && client.currentWeight && client.height && client.gender && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCalculateBMR}
                      disabled={isCalculatingBMR}
                    >
                      {isCalculatingBMR ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Calculating...
                        </>
                      ) : (
                        <>
                          <Calculator className="h-4 w-4 mr-2" />
                          Calculate BMR
                        </>
                      )}
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4">
                    {/* Weight Row */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Current Weight</p>
                        <p className="text-2xl font-bold">
                          {client.currentWeight
                            ? `${client.currentWeight} ${client.weightUnit || "lbs"}`
                            : checkIns[0]?.weight
                            ? `${checkIns[0].weight} ${checkIns[0].weightUnit || client.weightUnit || "lbs"}`
                            : "Not recorded"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Goal Weight</p>
                        <p className="text-2xl font-bold">
                          {client.goalWeight
                            ? `${client.goalWeight} ${client.weightUnit || "lbs"}`
                            : "Not set"}
                        </p>
                      </div>
                    </div>

                    {/* Body Fat Row */}
                    <div className="flex items-center justify-between pt-3 border-t">
                      <div>
                        <p className="text-sm text-muted-foreground">Current Body Fat %</p>
                        <p className="text-2xl font-bold">
                          {client.currentBodyFatPercentage
                            ? `${client.currentBodyFatPercentage}%`
                            : checkIns[0]?.bodyFatPercentage
                            ? `${checkIns[0].bodyFatPercentage}%`
                            : "Not recorded"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Goal Body Fat %</p>
                        <p className="text-2xl font-bold">
                          {client.goalBodyFatPercentage
                            ? `${client.goalBodyFatPercentage}%`
                            : "Not set"}
                        </p>
                      </div>
                    </div>

                    {/* Progress to Goal */}
                    {client.goalWeight && (client.currentWeight || checkIns[0]?.weight) && (
                      <div className="flex items-center justify-between pt-3 border-t">
                        <div>
                          <p className="text-sm text-muted-foreground">To Goal Weight</p>
                          <p className={`text-2xl font-bold ${
                            ((client.currentWeight || checkIns[0]?.weight || 0) - client.goalWeight) > 0
                              ? "text-orange-600"
                              : "text-green-600"
                          }`}>
                            {Math.abs((client.currentWeight || checkIns[0]?.weight || 0) - client.goalWeight).toFixed(1)} {client.weightUnit || "lbs"}
                          </p>
                        </div>
                        {client.goalBodyFatPercentage && (client.currentBodyFatPercentage || checkIns[0]?.bodyFatPercentage) && (
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground">To Goal Body Fat</p>
                            <p className={`text-2xl font-bold ${
                              ((client.currentBodyFatPercentage || checkIns[0]?.bodyFatPercentage || 0) - client.goalBodyFatPercentage) > 0
                                ? "text-orange-600"
                                : "text-green-600"
                            }`}>
                              {Math.abs((client.currentBodyFatPercentage || checkIns[0]?.bodyFatPercentage || 0) - client.goalBodyFatPercentage).toFixed(1)}%
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* BMR, TDEE & Physical Stats */}
                    <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                      <div>
                        <p className="text-sm text-muted-foreground">BMR (Basal Metabolic Rate)</p>
                        <p className="text-lg font-bold">
                          {client.bmr
                            ? `${Math.round(client.bmr)} cal/day`
                            : "Not calculated"}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">TDEE (Sedentary)</p>
                        <p className="text-lg font-bold">
                          {client.tdee
                            ? `${Math.round(client.tdee)} cal/day`
                            : "Not calculated"}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 pt-3 border-t">
                      <div>
                        <p className="text-sm text-muted-foreground">Height</p>
                        <p className="text-lg font-bold">
                          {client.height
                            ? `${client.height} ${client.heightUnit || "in"}`
                            : "Not set"}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Gender</p>
                        <p className="text-lg font-bold capitalize">
                          {client.gender || "Not set"}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Check-In Schedule */}
            <CheckInScheduleCard client={client} onUpdate={() => window.location.reload()} />

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
                <div className="text-center py-12 text-muted-foreground">
                  <p>Training program management coming soon</p>
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
                <div className="text-center py-12 text-muted-foreground">
                  <p>Nutrition tracking coming soon</p>
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
                <div className="text-center py-12 text-muted-foreground">
                  <p>Content sharing coming soon</p>
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
                {client.notes ? (
                  <div className="p-4 rounded-lg border">
                    <p className="whitespace-pre-wrap">{client.notes}</p>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>No notes added yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
          </>
        )}
      </div>
    </AppLayout>
  )
}
