"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  LABEL_CLASS,
  MONO,
  MONO_META_CLASS,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens"
import type {
  ClientIntake,
  PrimaryGoal,
  WorkActivityLevel,
  TrainingLocation,
  TrainingExperience,
  CookingFrequency,
} from "@/types/client-intake"
import { useUnits } from "@/contexts/units-context"
import { formatHeight, formatWeight, type UnitSystem } from "@/utils/unit-conversions"

// The COACH is the viewer here — this is the coach-side intake review. Intake
// values are canonical kg/cm; heightUnit/weightUnit were mapper constants, so
// the `?? "cm"` / `?? "kg"` fallbacks never fired.
//
// Imperial height is COMPOSITE — 5'11", never 71 in — hence formatHeight's
// discriminated union rather than a {value, unit} pair.
function showHeightIn(valueCm: number, viewer: UnitSystem): string {
  const h = formatHeight(valueCm, viewer)
  return h.system === "metric"
    ? `${Math.round(h.value)} ${h.unit}`
    : `${h.feet}'${h.inches}"`
}

function showWeightIn(valueKg: number, viewer: UnitSystem): string {
  const { value, unit } = formatWeight(valueKg, viewer)
  return `${Math.round(value * 10) / 10} ${unit}`
}

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

function QuoteBlock({ text }: { text: string }) {
  return (
    <div className="bg-[rgba(13,148,136,0.05)] border-l-[3px] border-[rgba(13,148,136,0.08)] rounded-r-[6px] px-4 py-3">
      <p className="text-[12px] text-[#0c1a1e] italic">{text}</p>
    </div>
  )
}

// `mono` marks the number-bearing values (heights, weights, counts, dates);
// word-only values (activity levels, locations, yes/no) stay sans.
function MetricItem({ label, value, mono }: { label: string; value: string | number | undefined; mono?: boolean }) {
  if (value == null || value === "") return null
  return (
    <div>
      <p className={LABEL_CLASS}>{label}</p>
      <p className={cn("text-[13px] font-medium", mono && MONO, TEXT_PRIMARY)}>{value}</p>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return <h3 className="text-[13px] font-semibold tracking-tight text-[#0c1a1e] mb-3">{title}</h3>
}

function hasAnyValue(...values: (string | number | boolean | string[] | null | undefined)[]): boolean {
  return values.some(v => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
}

type IntakeContentSectionsProps = {
  intake: ClientIntake
  compact?: boolean
}

export function IntakeContentSections({ intake, compact }: IntakeContentSectionsProps) {
  const { preference } = useUnits()
  // Compact (floating panel): no border, spacing does the separation on white bg
  // Full page: white cards on #f4f7f6, no border needed per design system
  const sectionClass = compact
    ? "bg-white rounded-[6px] p-4"
    : "bg-white rounded-[6px] p-5"

  return (
    <div className={compact ? "space-y-3" : "space-y-6"}>
      {/* About + Lifestyle & Training */}
      <div className={compact ? "space-y-3" : "grid gap-6 lg:grid-cols-2"}>
        <section className={sectionClass}>
          <SectionHeader title="About" />
          <div className="grid grid-cols-2 gap-4">
            <MetricItem mono label="Date of Birth" value={intake.dateOfBirth} />
            <MetricItem label="Gender" value={intake.gender ? intake.gender.charAt(0).toUpperCase() + intake.gender.slice(1) : undefined} />
            <MetricItem mono label="Height" value={intake.height ? showHeightIn(intake.height, preference) : undefined} />
            <MetricItem mono label="Current Weight" value={intake.currentWeight ? showWeightIn(intake.currentWeight, preference) : undefined} />
            <MetricItem mono label="Body Fat %" value={intake.bodyFatPercentage ? `${intake.bodyFatPercentage}%` : undefined} />
            <MetricItem label="Activity Level" value={intake.workActivityLevel ? ACTIVITY_LABELS[intake.workActivityLevel] : undefined} />
          </div>
        </section>

        <section className={sectionClass}>
          <SectionHeader title="Lifestyle & Training" />
          <div className="grid grid-cols-2 gap-4">
            <MetricItem label="Experience" value={intake.trainingExperienceLevel ? EXPERIENCE_LABELS[intake.trainingExperienceLevel] : undefined} />
            <MetricItem mono label="Days per Week" value={intake.daysPerWeek} />
            <MetricItem mono label="Session Duration" value={intake.sessionDurationMinutes ? `${intake.sessionDurationMinutes} min` : undefined} />
            <MetricItem label="Preferred Time" value={intake.trainingTimePreference ? intake.trainingTimePreference.charAt(0).toUpperCase() + intake.trainingTimePreference.slice(1) : undefined} />
            <MetricItem label="Location" value={intake.trainingLocation ? LOCATION_LABELS[intake.trainingLocation] : undefined} />
            <MetricItem label="Equipment" value={intake.availableEquipment?.join(", ")} />
          </div>
        </section>
      </div>

      {/* Goals */}
      {hasAnyValue(intake.primaryGoal, intake.targetWeight, intake.goalDeadline, intake.goalDescription, intake.motivation) && (
        <section className={sectionClass}>
          <SectionHeader title="Goals" />
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {intake.primaryGoal && (
                <Badge className="bg-[rgba(13,148,136,0.08)] text-[#0d9488] border-none rounded-[6px] text-[11px] font-medium">
                  {GOAL_LABELS[intake.primaryGoal] ?? intake.primaryGoal}
                </Badge>
              )}
              {intake.targetWeight != null && (
                <span className={cn(MONO_META_CLASS, "text-[12px]")}>
                  Target: {showWeightIn(intake.targetWeight, preference)}
                </span>
              )}
              {intake.goalBodyFatPercentage != null && (
                <span className={cn(MONO_META_CLASS, "text-[12px]")}>
                  Goal BF: {intake.goalBodyFatPercentage}%
                </span>
              )}
              {intake.goalDeadline && (
                <span className={cn(MONO_META_CLASS, "text-[12px]")}>
                  by {new Date(intake.goalDeadline).toLocaleDateString()}
                </span>
              )}
            </div>
            {intake.goalDescription && <QuoteBlock text={intake.goalDescription} />}
            {intake.motivation && (
              <div>
                <p className={cn(LABEL_CLASS, "mb-1")}>Motivation</p>
                <QuoteBlock text={intake.motivation} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Nutrition + History & Medical */}
      <div className={compact ? "space-y-3" : "grid gap-6 lg:grid-cols-2"}>
        {hasAnyValue(intake.cookingFrequency, intake.mealsPerDay, intake.hasTrackedMacrosBefore, intake.dietaryRequirements, intake.foodAllergies, intake.dietDescription, intake.biggestNutritionChallenge) && (
          <section className={sectionClass}>
            <SectionHeader title="Nutrition" />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <MetricItem label="Cooking" value={intake.cookingFrequency ? COOKING_LABELS[intake.cookingFrequency] : undefined} />
                <MetricItem mono label="Meals per Day" value={intake.mealsPerDay} />
                <MetricItem label="Tracked Macros Before" value={intake.hasTrackedMacrosBefore != null ? (intake.hasTrackedMacrosBefore ? "Yes" : "No") : undefined} />
                <MetricItem label="Dietary Requirements" value={intake.dietaryRequirements?.join(", ")} />
                <MetricItem label="Food Allergies" value={intake.foodAllergies} />
              </div>
              {intake.dietDescription && (
                <div>
                  <p className={cn(LABEL_CLASS, "mb-1")}>Current Diet</p>
                  <QuoteBlock text={intake.dietDescription} />
                </div>
              )}
              {intake.biggestNutritionChallenge && (
                <div>
                  <p className={cn(LABEL_CLASS, "mb-1")}>Biggest Challenge</p>
                  <QuoteBlock text={intake.biggestNutritionChallenge} />
                </div>
              )}
            </div>
          </section>
        )}

        {hasAnyValue(intake.injuriesOrLimitations, intake.medicalNotes, intake.previousCoachingExperience, intake.previousCoachingDetails, intake.anythingElse) && (
          <section className={sectionClass}>
            <SectionHeader title="History & Medical" />
            <div className="space-y-3">
              {intake.injuriesOrLimitations && (
                <div>
                  <p className={cn(LABEL_CLASS, "mb-1")}>Injuries or Limitations</p>
                  <QuoteBlock text={intake.injuriesOrLimitations} />
                </div>
              )}
              {intake.medicalNotes && (
                <div>
                  <p className={cn(LABEL_CLASS, "mb-1")}>Medical Notes</p>
                  <QuoteBlock text={intake.medicalNotes} />
                </div>
              )}
              <MetricItem label="Previous Coaching" value={intake.previousCoachingExperience != null ? (intake.previousCoachingExperience ? "Yes" : "No") : undefined} />
              {intake.previousCoachingDetails && (
                <div>
                  <p className={cn(LABEL_CLASS, "mb-1")}>Previous Coaching Details</p>
                  <QuoteBlock text={intake.previousCoachingDetails} />
                </div>
              )}
              {intake.anythingElse && (
                <div>
                  <p className={cn(LABEL_CLASS, "mb-1")}>Additional Notes</p>
                  <QuoteBlock text={intake.anythingElse} />
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
