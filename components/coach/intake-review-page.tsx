"use client"

import { useState, useCallback } from "react"
import { Textarea } from "@/components/ui/textarea"
import { IntakeReviewActions } from "./intake-review-actions"
import { IntakeContentSections } from "./intake-content-sections"
import type { ClientIntake } from "@/types/client-intake"

type IntakeReviewPageProps = {
  intake: ClientIntake
  clientId: string
  clientName?: string
}

export function IntakeReviewPage({ intake, clientId, clientName }: IntakeReviewPageProps) {
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
      <IntakeContentSections intake={intake} />

      {/* Coach Notes - full width */}
      <section className="bg-white rounded-[6px] p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold tracking-tight text-[#0c1a1e]">Coach Notes</h3>
          {saving && <span className="text-[11px] text-[#93b0b4]">Saving...</span>}
        </div>
        <Textarea
          placeholder="Add your private notes about this intake..."
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          className="resize-none"
        />
        <p className="text-[11px] text-[#93b0b4] mt-1">Only visible to you. Saves automatically.</p>
      </section>

      {/* Actions */}
      <section className="bg-white rounded-[6px] p-5">
        <IntakeReviewActions clientId={clientId} intakeStatus={intake.status} intake={intake} clientName={clientName} />
      </section>
    </div>
  )
}
