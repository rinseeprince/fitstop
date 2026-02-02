import { useState } from "react"
import { useToast } from "@/hooks/use-toast"
import type { MetricSaveOption } from "@/types/check-in"

interface UseClientMetricsOptions {
  clientId: string
  onSuccess?: () => void
}

export function useClientMetrics({ clientId, onSuccess }: UseClientMetricsOptions) {
  const { toast } = useToast()
  const [isCalculatingBMR, setIsCalculatingBMR] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [pendingMetricUpdate, setPendingMetricUpdate] = useState<{
    field: string
    value: number
    metricName: string
  } | null>(null)
  const [isSavingMetric, setIsSavingMetric] = useState(false)

  const handleCalculateBMR = async () => {
    setIsCalculatingBMR(true)
    try {
      const response = await fetch(`/api/clients/${clientId}/calculate-bmr`, {
        method: "POST",
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to calculate BMR")
      }

      toast({
        title: "BMR Calculated",
        description: `BMR: ${data.bmr} cal/day, TDEE: ${data.tdee} cal/day`,
      })

      onSuccess?.()
    } catch (error) {
      toast({
        title: "Failed to calculate BMR",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      })
    } finally {
      setIsCalculatingBMR(false)
    }
  }

  const handleMetricSave = async (
    field: string,
    value: number,
    metricName: string,
    needsConfirmation: boolean
  ) => {
    if (needsConfirmation) {
      setPendingMetricUpdate({ field, value, metricName })
      setSaveDialogOpen(true)
    } else {
      await saveMetric(field, value, "update-only")
    }
  }

  const saveMetric = async (field: string, value: number, saveOption: MetricSaveOption) => {
    setIsSavingMetric(true)
    try {
      const body: Record<string, unknown> = { saveOption }
      body[field] = value

      const response = await fetch(`/api/clients/${clientId}/metrics`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to update metric")
      }

      toast({
        title: "Metric Updated",
        description: `Successfully updated ${pendingMetricUpdate?.metricName || "metric"}`,
      })

      onSuccess?.()
      setSaveDialogOpen(false)
      setPendingMetricUpdate(null)
    } catch (error) {
      toast({
        title: "Failed to update metric",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      })
      throw error
    } finally {
      setIsSavingMetric(false)
    }
  }

  const handleResetToAuto = async (field: "bmr" | "tdee") => {
    try {
      const body: Record<string, boolean> = {}
      if (field === "bmr") {
        body.bmrManualOverride = false
      } else {
        body.tdeeManualOverride = false
      }

      const response = await fetch(`/api/clients/${clientId}/metrics`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to reset")
      }

      toast({
        title: `${field.toUpperCase()} Reset`,
        description: `${field.toUpperCase()} will now auto-calculate`,
      })

      onSuccess?.()
    } catch (error) {
      toast({
        title: "Failed to reset",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      })
      throw error
    }
  }

  return {
    isCalculatingBMR,
    saveDialogOpen,
    setSaveDialogOpen,
    pendingMetricUpdate,
    isSavingMetric,
    handleCalculateBMR,
    handleMetricSave,
    saveMetric,
    handleResetToAuto,
  }
}
