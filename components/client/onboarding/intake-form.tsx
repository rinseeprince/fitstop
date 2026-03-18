"use client"

import { useState, useCallback } from "react"
import { ArrowLeft, ArrowRight, Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProgressIndicator } from "@/components/check-in/progress-indicator"
import { IntakeStep1 } from "./intake-step-1"
import { IntakeStep2 } from "./intake-step-2"
import { IntakeStep3 } from "./intake-step-3"
import { IntakeStep4 } from "./intake-step-4"
import { IntakeStep5 } from "./intake-step-5"
import { intakeStepSchemas } from "@/lib/validations/client-intake"
import { toast } from "sonner"
import type { ClientIntake } from "@/types/client-intake"

type IntakeFormProps = {
  intake: ClientIntake
  stepsComplete: number[]
  onComplete: () => void
}

const stepLabels = ["About You", "Goals", "Lifestyle", "Nutrition", "History"]

// Fields belonging to each step for extraction
const stepFields = {
  1: ["dateOfBirth", "gender", "height", "currentWeight", "bodyFatPercentage"],
  2: ["primaryGoal", "targetWeight", "goalBodyFatPercentage", "goalDeadline", "goalDescription", "motivation"],
  3: ["workActivityLevel", "daysPerWeek", "trainingTimePreference", "trainingLocation", "availableEquipment", "sessionDurationMinutes"],
  4: ["dietaryRequirements", "foodAllergies", "dietDescription", "cookingFrequency", "hasTrackedMacrosBefore", "mealsPerDay", "biggestNutritionChallenge"],
  5: ["injuriesOrLimitations", "trainingExperienceLevel", "previousCoachingExperience", "previousCoachingDetails", "anythingElse"],
} as const satisfies Record<number, readonly (keyof ClientIntake)[]>

function getFirstIncompleteStep(stepsComplete: number[]): number {
  for (let i = 1; i <= 5; i++) {
    if (!stepsComplete.includes(i)) return i
  }
  return 1
}

export function IntakeForm({ intake, stepsComplete, onComplete }: IntakeFormProps) {
  const [currentStep, setCurrentStep] = useState(() => getFirstIncompleteStep(stepsComplete))
  const [formData, setFormData] = useState<Partial<ClientIntake>>(intake)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)

  const updateFormData = useCallback(
    (fields: Partial<ClientIntake>) => {
      setFormData((prev) => ({ ...prev, ...fields }))
      // Clear errors for changed fields
      const clearedErrors = { ...errors }
      for (const key of Object.keys(fields)) {
        delete clearedErrors[key]
      }
      setErrors(clearedErrors)
    },
    [errors]
  )

  const extractStepData = (step: number) => {
    const fields = stepFields[step as keyof typeof stepFields]
    const data: Record<string, unknown> = {}
    for (const field of fields) {
      const val = (formData as Record<string, unknown>)[field]
      if (val !== undefined && val !== null && val !== "") {
        data[field] = val
      }
    }
    return data
  }

  const validateStep = (step: number): boolean => {
    const data = extractStepData(step)
    const schema = intakeStepSchemas[step - 1]
    const result = schema.safeParse(data)
    if (result.success) {
      setErrors({})
      return true
    }
    const newErrors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join(".")
      if (!newErrors[path]) newErrors[path] = issue.message
    }
    setErrors(newErrors)
    return false
  }

  const saveStep = async (step: number): Promise<boolean> => {
    const data = extractStepData(step)
    try {
      const res = await fetch(`/api/client/intake/step/${step}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.error || "Failed to save")
        return false
      }
      return true
    } catch {
      toast.error("Network error. Please try again.")
      return false
    }
  }

  const handleContinue = async () => {
    if (!validateStep(currentStep)) return
    setIsSaving(true)
    const saved = await saveStep(currentStep)
    setIsSaving(false)
    if (!saved) return
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1)
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) return
    setIsSaving(true)
    const saved = await saveStep(currentStep)
    if (!saved) { setIsSaving(false); return }

    try {
      const res = await fetch("/api/client/intake/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.error || "Failed to submit")
        setIsSaving(false)
        return
      }
      toast.success("Intake submitted!")
      onComplete()
    } catch {
      toast.error("Network error. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
      setErrors({})
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  const stepProps = { data: formData, onChange: updateFormData, errors }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-1">Let&apos;s get to know you</h1>
        <p className="text-sm text-muted-foreground">
          This helps your coach build the perfect plan for you.
        </p>
      </div>

      <ProgressIndicator currentStep={currentStep} totalSteps={5} stepLabels={stepLabels} />

      <div className="min-h-[400px]">
        {currentStep === 1 && <IntakeStep1 {...stepProps} />}
        {currentStep === 2 && <IntakeStep2 {...stepProps} />}
        {currentStep === 3 && <IntakeStep3 {...stepProps} />}
        {currentStep === 4 && <IntakeStep4 {...stepProps} />}
        {currentStep === 5 && <IntakeStep5 {...stepProps} />}
      </div>

      <div className="flex items-center justify-between gap-4 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 1 || isSaving}
          className="flex-1 sm:flex-none"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        {currentStep < 5 ? (
          <Button
            type="button"
            onClick={handleContinue}
            disabled={isSaving}
            className="flex-1 sm:flex-none"
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            {isSaving ? "Saving..." : "Continue"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="flex-1 sm:flex-none"
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {isSaving ? "Submitting..." : "Submit"}
          </Button>
        )}
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Your progress is saved on each step
      </p>
    </div>
  )
}
