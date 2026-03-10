"use client"

import { useState, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { IntakeReviewActions } from "./intake-review-actions"
import type { ClientIntake, PrimaryGoal, WorkActivityLevel, TrainingLocation, TrainingExperience, CookingFrequency } from "@/types/client-intake"

const GOAL_LABELS: Record<PrimaryGoal, string> = {
  lose_weight: "Lose Weight",
  build_muscle: "Build Muscle",
  recomposition: "Body Recomposition",
  general_fitness: "General Fitness",
  event_prep: "Event Preparation",
  maintain: "Maintain",
}

const ACTIVITY_LABELS: Record<WorkActivityLevel, string> = {
  sedentary: "Sedentary",
  lightly_active: "Lightly Active",
  moderately_active: "Moderately Active",
  very_active: "Very Active",
  extremely_active: "Extremely Active",
}

const LOCATION_LABELS: Record<TrainingLocation, string> = {
  commercial_gym: "Commercial Gym",
  home_gym: "Home Gym",
  home_no_equipment: "Home (No Equipment)",
  outdoor: "Outdoor",
  mixed: "Mixed",
}

const EXPERIENCE_LABELS: Record<TrainingExperience, string> = {
  complete_beginner: "Complete Beginner",
  some_experience: "Some Experience",
  intermediate: "Intermediate",
  advanced: "Advanced",
}

const COOKING_LABELS: Record<CookingFrequency, string> = {
  mostly_cook: "Mostly Cook",
  mix_of_both: "Mix of Both",
  mostly_eat_out: "Mostly Eat Out",
  meal_prep: "Meal Prep",
}

type IntakeReviewPageProps = {
  intake: ClientIntake
  clientId: string
}

function QuoteBlock({ text }: { text: string }) {
  return (
    <div className="bg-muted/50 border-l-4 border-border rounded-r-md px-4 py-3">
      <p className="text-sm text-foreground italic">{text}</p>
    </div>
  )
}

function MetricItem({ label, value }: { label: string; value: string | number | undefined }) {
  if (value == null || value === "") return null
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return <h3 className="text-base font-semibold tracking-tight text-foreground mb-3">{title}</h3>
}

export function IntakeReviewPage({ intake, clientId }: IntakeReviewPageProps) {
  const [notes, setNotes] = useState(intake.coachReviewNotes ?? "")
  const [saving, setSaving] = useState(false)

  const handleNotesBlur = useCallback(async () => {
    if (notes === (intake.coachReviewNotes ?? "")) return
    setSaving(true)
    try {
      await fetch(`/api/clients/${clientId}/intake`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachReviewNotes: notes }),
      })
    } catch (err) {
      console.error("Failed to save notes:", err)
    } finally {
      setSaving(false)
    }
  }, [notes, intake.coachReviewNotes, clientId])

  return (
    <div className="space-y-6">
      {/* Row 1: About + Lifestyle & Training */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="bg-card border border-border rounded-lg p-5">
          <SectionHeader title="About" />
          <div className="grid grid-cols-2 gap-4">
            <MetricItem label="Date of Birth" value={intake.dateOfBirth} />
            <MetricItem label="Gender" value={intake.gender ? intake.gender.charAt(0).toUpperCase() + intake.gender.slice(1) : undefined} />
            <MetricItem label="Height" value={intake.height ? `${intake.height} ${intake.heightUnit ?? "cm"}` : undefined} />
            <MetricItem label="Current Weight" value={intake.currentWeight ? `${intake.currentWeight} ${intake.weightUnit ?? "kg"}` : undefined} />
            <MetricItem label="Body Fat %" value={intake.bodyFatPercentage ? `${intake.bodyFatPercentage}%` : undefined} />
            <MetricItem label="Activity Level" value={intake.workActivityLevel ? ACTIVITY_LABELS[intake.workActivityLevel] : undefined} />
          </div>
        </section>

        <section className="bg-card border border-border rounded-lg p-5">
          <SectionHeader title="Lifestyle & Training" />
          <div className="grid grid-cols-2 gap-4">
            <MetricItem label="Experience" value={intake.trainingExperienceLevel ? EXPERIENCE_LABELS[intake.trainingExperienceLevel] : undefined} />
            <MetricItem label="Days per Week" value={intake.daysPerWeek} />
            <MetricItem label="Session Duration" value={intake.sessionDurationMinutes ? `${intake.sessionDurationMinutes} min` : undefined} />
            <MetricItem label="Preferred Time" value={intake.trainingTimePreference ? intake.trainingTimePreference.charAt(0).toUpperCase() + intake.trainingTimePreference.slice(1) : undefined} />
            <MetricItem label="Location" value={intake.trainingLocation ? LOCATION_LABELS[intake.trainingLocation] : undefined} />
            <MetricItem label="Equipment" value={intake.availableEquipment?.join(", ")} />
          </div>
        </section>
      </div>

      {/* Goals - full width for long text */}
      <section className="bg-card border border-border rounded-lg p-5">
        <SectionHeader title="Goals" />
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {intake.primaryGoal && (
              <Badge>{GOAL_LABELS[intake.primaryGoal] ?? intake.primaryGoal}</Badge>
            )}
            {intake.targetWeight != null && (
              <span className="text-sm text-muted-foreground">
                Target: {intake.targetWeight} {intake.weightUnit ?? "kg"}
              </span>
            )}
            {intake.goalDeadline && (
              <span className="text-sm text-muted-foreground">
                by {new Date(intake.goalDeadline).toLocaleDateString()}
              </span>
            )}
          </div>
          {intake.goalDescription && <QuoteBlock text={intake.goalDescription} />}
          {intake.motivation && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Motivation</p>
              <QuoteBlock text={intake.motivation} />
            </div>
          )}
        </div>
      </section>

      {/* Row 2: Nutrition + History & Medical */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="bg-card border border-border rounded-lg p-5">
          <SectionHeader title="Nutrition" />
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <MetricItem label="Cooking" value={intake.cookingFrequency ? COOKING_LABELS[intake.cookingFrequency] : undefined} />
              <MetricItem label="Meals per Day" value={intake.mealsPerDay} />
              <MetricItem label="Tracked Macros Before" value={intake.hasTrackedMacrosBefore != null ? (intake.hasTrackedMacrosBefore ? "Yes" : "No") : undefined} />
              <MetricItem label="Dietary Requirements" value={intake.dietaryRequirements?.join(", ")} />
              <MetricItem label="Food Allergies" value={intake.foodAllergies} />
            </div>
            {intake.dietDescription && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Current Diet</p>
                <QuoteBlock text={intake.dietDescription} />
              </div>
            )}
            {intake.biggestNutritionChallenge && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Biggest Challenge</p>
                <QuoteBlock text={intake.biggestNutritionChallenge} />
              </div>
            )}
          </div>
        </section>

        <section className="bg-card border border-border rounded-lg p-5">
          <SectionHeader title="History & Medical" />
          <div className="space-y-3">
            {intake.injuriesOrLimitations && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Injuries or Limitations</p>
                <QuoteBlock text={intake.injuriesOrLimitations} />
              </div>
            )}
            {intake.medicalNotes && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Medical Notes</p>
                <QuoteBlock text={intake.medicalNotes} />
              </div>
            )}
            <MetricItem label="Previous Coaching" value={intake.previousCoachingExperience != null ? (intake.previousCoachingExperience ? "Yes" : "No") : undefined} />
            {intake.previousCoachingDetails && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Previous Coaching Details</p>
                <QuoteBlock text={intake.previousCoachingDetails} />
              </div>
            )}
            {intake.anythingElse && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Additional Notes</p>
                <QuoteBlock text={intake.anythingElse} />
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Coach Notes - full width */}
      <section className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionHeader title="Coach Notes" />
          {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
        </div>
        <Textarea
          placeholder="Add your private notes about this intake..."
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground mt-1">Only visible to you. Saves automatically.</p>
      </section>

      {/* Actions */}
      <section className="bg-card border border-border rounded-lg p-5">
        <IntakeReviewActions clientId={clientId} intakeStatus={intake.status} />
      </section>
    </div>
  )
}
