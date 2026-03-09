"use client"

import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SelectableCard } from "./selectable-card"
import type { ClientIntake, TrainingExperience } from "@/types/client-intake"

type IntakeStep5Props = {
  data: Partial<ClientIntake>
  onChange: (fields: Partial<ClientIntake>) => void
  errors: Record<string, string>
}

const experienceOptions: { value: TrainingExperience; label: string; desc: string }[] = [
  { value: "complete_beginner", label: "Complete Beginner", desc: "Never trained before" },
  { value: "some_experience", label: "Some Experience", desc: "Trained on and off" },
  { value: "intermediate", label: "Intermediate", desc: "Consistent for 1-2 years" },
  { value: "advanced", label: "Advanced", desc: "3+ years of consistent training" },
]

export function IntakeStep5({ data, onChange, errors }: IntakeStep5Props) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Your History</h3>
        <p className="text-sm text-muted-foreground">
          Almost done — a few last things for your coach
        </p>
      </div>

      {/* Injuries */}
      <div className="space-y-2">
        <Label>Any injuries, pain, or physical limitations?</Label>
        <Textarea
          placeholder="e.g. old shoulder injury, lower back pain, knee issues..."
          value={data.injuriesOrLimitations || ""}
          onChange={(e) => onChange({ injuriesOrLimitations: e.target.value })}
          rows={3}
          maxLength={500}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground">
          Leave blank if none — this helps us keep you safe
        </p>
        {errors.injuriesOrLimitations && (
          <p className="text-sm text-destructive">{errors.injuriesOrLimitations}</p>
        )}
      </div>

      {/* Training Experience */}
      <div className="space-y-2">
        <Label>How would you describe your training experience?</Label>
        <div className="space-y-2">
          {experienceOptions.map((opt) => (
            <SelectableCard
              key={opt.value}
              selected={data.trainingExperienceLevel === opt.value}
              onClick={() => onChange({ trainingExperienceLevel: opt.value })}
              className="w-full flex-row items-center justify-start gap-3 text-left"
            >
              <div>
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </SelectableCard>
          ))}
        </div>
        {errors.trainingExperienceLevel && (
          <p className="text-sm text-destructive">{errors.trainingExperienceLevel}</p>
        )}
      </div>

      {/* Previous Coaching */}
      <div className="space-y-2">
        <Label>Have you worked with a coach before?</Label>
        <div className="grid grid-cols-2 gap-3">
          <SelectableCard
            selected={data.previousCoachingExperience === true}
            onClick={() => onChange({ previousCoachingExperience: true })}
          >
            <span className="text-sm font-medium">Yes</span>
          </SelectableCard>
          <SelectableCard
            selected={data.previousCoachingExperience === false}
            onClick={() => onChange({ previousCoachingExperience: false })}
          >
            <span className="text-sm font-medium">No</span>
          </SelectableCard>
        </div>
      </div>

      {/* Conditional: Previous Coaching Details */}
      {data.previousCoachingExperience === true && (
        <div className="space-y-2">
          <Label>What worked and what didn&apos;t?</Label>
          <Textarea
            placeholder="Tell us about your experience — what was helpful and what wasn't?"
            value={data.previousCoachingDetails || ""}
            onChange={(e) => onChange({ previousCoachingDetails: e.target.value })}
            rows={3}
            maxLength={500}
            className="resize-none"
          />
        </div>
      )}

      {/* Anything Else */}
      <div className="space-y-2">
        <Label>Anything else you&apos;d like your coach to know?</Label>
        <Textarea
          placeholder="Any additional context, preferences, or questions..."
          value={data.anythingElse || ""}
          onChange={(e) => onChange({ anythingElse: e.target.value })}
          rows={4}
          maxLength={1000}
          className="resize-none"
        />
      </div>
    </div>
  )
}
