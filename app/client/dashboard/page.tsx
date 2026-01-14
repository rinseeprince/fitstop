"use client"

import { useAuth } from "@/contexts/auth-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dumbbell, ClipboardCheck, TrendingUp, Calendar } from "lucide-react"

export default function ClientDashboardPage() {
  const { user } = useAuth()

  const firstName = user?.user_metadata?.name?.split(" ")[0] || "there"

  return (
    <div className="space-y-6">
      {/* Welcome message */}
      <div>
        <h1 className="text-2xl font-bold">Welcome, {firstName}!</h1>
        <p className="text-muted-foreground">
          Track your progress and stay connected with your coach.
        </p>
      </div>

      {/* Feature cards - coming soon */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Dumbbell className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-base">Training Plans</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              View your personalized training programs from your coach.
            </p>
            <p className="mt-2 text-xs text-muted-foreground/60">
              Coming soon
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <ClipboardCheck className="h-5 w-5 text-green-600" />
            </div>
            <CardTitle className="text-base">Check-ins</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Submit weekly check-ins and track your consistency.
            </p>
            <p className="mt-2 text-xs text-muted-foreground/60">
              Coming soon
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              See your progress over time with charts and insights.
            </p>
            <p className="mt-2 text-xs text-muted-foreground/60">
              Coming soon
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
              <Calendar className="h-5 w-5 text-orange-600" />
            </div>
            <CardTitle className="text-base">Nutrition</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Access your nutrition plan and macro targets.
            </p>
            <p className="mt-2 text-xs text-muted-foreground/60">
              Coming soon
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Info card */}
      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-muted-foreground">
              Your coach will share training plans, nutrition guidance, and
              progress tracking with you here. Stay tuned!
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
