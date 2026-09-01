"use client"

import { useCallback } from "react"
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
import { buildClientTabUrl, type ClientTab } from "@/lib/client-tabs"
import { AlertCircle } from "lucide-react"

const VALID_TABS = new Set<ClientTab>(["overview", "metrics", "training", "nutrition", "wellness", "daily-habits", "check-ins", "notes"])

export default function ClientProfilePage() {
  const params = useParams()
  const clientId = params.id as string
  const searchParams = useSearchParams()
  const router = useRouter()

  // DERIVED from the URL, never mirrored into state. The URL is the one source
  // of truth for which tab is open, so `?tab=` and anything a caller addresses
  // alongside it (`?checkIn=`, `?journey=`) land in ONE update and one render.
  // Mirrored into state, the tab flipped synchronously while the replace landed
  // a render later — long enough for a newly-mounted tab to read the PREVIOUS
  // tab's query, which is how "Review check-in" showed the check-in list for a
  // frame before the check-in it was told to open.
  // `metrics-tab-content.tsx` derives its own pane the same way.
  const tabParam = searchParams.get("tab")
  const activeTab: ClientTab =
    tabParam && VALID_TABS.has(tabParam as ClientTab) ? (tabParam as ClientTab) : "overview"

  const { client, isLoading: clientLoading, isError: clientError, mutate: mutateClient } = useClient(clientId)

  const handleTabChange = useCallback((tab: ClientTab, extraParams?: Record<string, string | null>) => {
    // Single-owner params (Journey's ?journey=) survive the switch so that
    // pane restores on the return trip; the SHARED ?subtab= (written by both
    // Training and Nutrition) is dropped — carried across, it satisfies the
    // other tab's pane guard and opens the wrong pane. See buildClientTabUrl.
    // extraParams ADDRESS a pane on arrival (the Overview's block-ending row
    // sends { journey: "blocks" }).
    router.replace(buildClientTabUrl(clientId, tab, searchParams.toString(), extraParams), { scroll: false })
  }, [clientId, router, searchParams])


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
              onClientUpdated={() => mutateClient()}
              onTabChange={handleTabChange}
            />
          </TabsContent>

          {/* Metrics Tab */}
          <TabsContent value="metrics" className="mt-0">
            <MetricsTabContent
              client={client}
              onClientUpdated={() => void mutateClient()}
              onTabChange={handleTabChange}
            />
          </TabsContent>

          {/* Training Plan Tab */}
          <TabsContent value="training" className="space-y-6 mt-0">
            <TrainingPlanCard
              client={client}
              onTabChange={handleTabChange}
            />
          </TabsContent>

          {/* Nutrition Tab */}
          <TabsContent value="nutrition" className="space-y-6 mt-0">
            <NutritionCalculatorCardEnhanced
              client={client}
              onUpdate={() => mutateClient()}
              onTabChange={handleTabChange}
            />
          </TabsContent>

          {/* Wellness Tab */}
          <TabsContent value="wellness" className="space-y-6 mt-0">
            <WellnessTabContent client={client} />
          </TabsContent>

          {/* Daily Habits Tab */}
          <TabsContent value="daily-habits" className="space-y-6 mt-0">
            <HabitsTabContent client={client} />
          </TabsContent>

          {/* Check-ins Tab */}
          <TabsContent value="check-ins" className="space-y-6 mt-0">
            <CheckInsTabContent client={client} onTabChange={handleTabChange} />
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
