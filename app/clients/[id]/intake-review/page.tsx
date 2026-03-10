"use client"

import { use } from "react"
import useSWR from "swr"
import { AppLayout } from "@/components/app-layout"
import { PageHeader } from "@/components/page-header"
import { IntakeReviewPage } from "@/components/coach/intake-review-page"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import type { ClientIntake } from "@/types/client-intake"

const fetcher = async (url: string) => { const r = await fetch(url); return r.json() }

export default function IntakeReviewRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: clientId } = use(params)
  const { data, isLoading, error } = useSWR<{ success: boolean; data: ClientIntake }>(
    `/api/clients/${clientId}/intake`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const intake = data?.data

  const pageHeader = (
    <PageHeader
      title="Intake Review"
      description={intake ? `Reviewing intake for this client` : "Loading..."}
    />
  )

  return (
    <AppLayout
      pageHeader={pageHeader}
      headerActions={
        <Link href={`/clients/${clientId}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4" />
            Back to Client
          </Button>
        </Link>
      }
    >
      <div className="max-w-7xl mx-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-center py-16">
            <p className="text-sm text-destructive">Failed to load intake data.</p>
          </div>
        )}

        {!isLoading && !error && !intake && (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">No intake found for this client.</p>
          </div>
        )}

        {intake && <IntakeReviewPage intake={intake} clientId={clientId} />}
      </div>
    </AppLayout>
  )
}
