import type { AlertSeverity } from "@/types/attention-feed"

/**
 * The one ordering of alert severities: high outranks medium outranks low.
 * The feed sorts each client's alerts with it before they leave the service,
 * so every surface reads red first; the Overview section sorts with it too,
 * rather than spelling a rank of its own.
 */
export const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 }

/** A new array, most severe first; equal severities keep their given order. */
export function sortAlertsBySeverity<T extends { severity: AlertSeverity }>(alerts: readonly T[]): T[] {
  return [...alerts].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}
