"use client"

import { useState, useCallback } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ClientDetailLayout } from "@/components/clients/client-detail-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { NutritionCalculatorCardEnhanced } from "@/components/clients/nutrition/nutrition-calculator-card-enhanced"
import { TrainingPlanCard } from "@/components/clients/training/training-plan-card"
import { MetricsTabContent } from "@/components/clients/metrics/metrics-tab-content"
import { ClientOverviewTab } from "@/components/clients/client-overview-tab"
import { HabitsTabContent } from "@/components/clients/habits/habits-tab-content"
import { CheckInsTabContent } from "@/components/clients/check-ins/check-ins-tab-content"
import { WellnessTabContent } from "@/components/clients/wellness/wellness-tab-content"
import { NotesTabContent } from "@/components/clients/notes/notes-tab-content"
import { useClient } from "@/hooks/use-check-in-data"
import { useClientMetrics } from "@/hooks/use-client-metrics"
import { type ClientTab } from "@/lib/client-tabs"
import { AlertCircle } from "lucide-react"

const VALID_TABS = new Set<ClientTab>(["overview", "metrics", "training", "nutrition", "wellness", "daily-habits", "check-ins", "notes"])

export default function ClientProfilePage() {
  const params = useParams()
  const clientId = params.id as string
  const searchParams = useSearchParams()
  const router = useRouter()

  const tabParam = searchParams.get("tab")
  const initialTab: ClientTab = tabParam && VALID_TABS.has(tabParam as ClientTab) ? (tabParam as ClientTab) : "overview"

  const { client, isLoading: clientLoading, isError: clientError, mutate: mutateClient } = useClient(clientId)
  const [activeTab, setActiveTab] = useState<ClientTab>(initialTab)

  const handleTabChange = useCallback((tab: ClientTab) => {
    setActiveTab(tab)
    // Preserve the rest of the query (notably ?subtab=) so a pane selection
    // survives a top-level tab round-trip — the bare `?tab=` rewrite silently
    // dropped it. Every tab's content already ignores a subtab written while
    // another tab was active, so a carried-over value is inert until its own
    // tab is back.
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", tab)
    router.replace(`/clients/${clientId}?${params.toString()}`, { scroll: false })
  }, [clientId, router, searchParams])

  const { isCalculatingBMR, handleCalculateBMR } = useClientMetrics({
    clientId,
    onSuccess: () => void mutateClient(),
  })

  const displayClient = client ?? { id: clientId, name: "", email: "" as string }

  return (
    <ClientDetailLayout
      client={displayClient}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      isLoading={clientLoading}
    >
      {clientError && !clientLoading ? (
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
      ) : client ? (
        <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as ClientTab)} className="space-y-6">
          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-0">
            <ClientOverviewTab
              client={client}
              isCalculatingBMR={isCalculatingBMR}
              onCalculateBMR={handleCalculateBMR}
              onClientUpdated={() => mutateClient()}
              onTabChange={handleTabChange}
            />
          </TabsContent>

          {/* Metrics Tab */}
          <TabsContent value="metrics" className="mt-0">
            <MetricsTabContent
              client={client}
              onClientUpdated={() => void mutateClient()}
            />
          </TabsContent>

          {/* Training Plan Tab */}
          <TabsContent value="training" className="space-y-6 mt-0">
            <TrainingPlanCard client={client} onUpdate={() => mutateClient()} />
          </TabsContent>

          {/* Nutrition Tab */}
          <TabsContent value="nutrition" className="space-y-6 mt-0">
            <NutritionCalculatorCardEnhanced
              client={client}
              onUpdate={() => mutateClient()}
            />
          </TabsContent>

          {/* Wellness Tab */}
          <TabsContent value="wellness" className="space-y-6 mt-0">
            <WellnessTabContent client={client} />
          </TabsContent>

          {/* Daily Habits Tab */}
          <TabsContent value="daily-habits" className="space-y-6 mt-0">
            <HabitsTabContent
              client={client}
              onUpdate={() => mutateClient()}
            />
          </TabsContent>

          {/* Check-ins Tab */}
          <TabsContent value="check-ins" className="space-y-6 mt-0">
            <CheckInsTabContent client={client} />
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="mt-0">
            <NotesTabContent client={client} />
          </TabsContent>
        </Tabs>
      ) : null}
    </ClientDetailLayout>
  )
}
