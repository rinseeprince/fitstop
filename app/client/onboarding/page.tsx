"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { IntakeForm } from "@/components/client/onboarding/intake-form"
import { CheckCircle, Loader2 } from "lucide-react"
import type { ClientIntake } from "@/types/client-intake"

export default function OnboardingPage() {
  const { user, loading: authLoading, profile } = useAuth()
  const router = useRouter()
  const [intake, setIntake] = useState<ClientIntake | null>(null)
  const [stepsComplete, setStepsComplete] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push("/login"); return }
    if (profile && profile.role !== "client") { router.push("/dashboard"); return }

    const fetchIntake = async () => {
      try {
        const res = await fetch("/api/client/intake")
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || "Failed to load")
        setIntake(json.data.intake)
        setStepsComplete(json.data.stepsComplete)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong")
      } finally {
        setLoading(false)
      }
    }
    fetchIntake()
  }, [user, authLoading, profile, router])

  if (authLoading || loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-destructive">{error}</p>
        <button onClick={() => window.location.reload()} className="text-sm text-primary underline">
          Try again
        </button>
      </div>
    )
  }

  if (!intake) return null

  // Completed or reviewed: show waiting state
  if (intake.status === "completed" || intake.status === "reviewed") {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center px-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">You&apos;re all set!</h1>
        <p className="text-muted-foreground max-w-sm">
          Your intake has been submitted. Your coach will review it and set up
          your personalised plan shortly.
        </p>
      </div>
    )
  }

  return (
    <IntakeForm
      intake={intake}
      stepsComplete={stepsComplete}
      onComplete={() => setIntake({ ...intake, status: "completed" })}
    />
  )
}
