/**
 * The two intake POSTs, in one place.
 *
 * The full-page review actions and the floating panel both fire these and keep
 * their own toasts, cache invalidation and navigation — which differ, and
 * legitimately so. What they must NOT each own is the endpoint and the body
 * shape: those were already spelled twice, and a third copy was about to be
 * written for the panel's new Sync button.
 */
export type IntakeAction = "sync-metrics" | "review";

/** Returns the parsed body; throws on a non-OK response so callers can toast. */
export async function postIntakeAction(
  clientId: string,
  action: IntakeAction
): Promise<{ data?: { syncedFields?: string[] } }> {
  const res = await fetch(`/api/clients/${clientId}/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    throw new Error(
      action === "review" ? "Failed to mark as reviewed" : "Failed to sync metrics"
    );
  }
  return (await res.json()) as { data?: { syncedFields?: string[] } };
}
