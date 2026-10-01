/**
 * Inline notice shown on a per-day detail page when a day can't be logged. A SINGLE
 * component (not per-variant) so every detail page renders the lock UX identically — the
 * `reason` prop switches the copy. The wrapper/markup mirror the original inline notice on
 * the nutrition page so swapping it in is DOM-neutral.
 */
type LockedDayReason = "locked" | "today-no-plan";

interface LockedDayNoticeProps {
  /**
   * Which situation the notice explains. `today-no-plan` is reserved for plan-gated
   * surfaces (nutrition/training; wellness is not plan-gated — Session 3.1C); current
   * pages only use `locked`.
   */
  reason: LockedDayReason;
}

/**
 * `locked` names no date and no cause deliberately (owner, 2026-09-04). The day
 * rule closes a day for two reasons — the week is in a check-in already sent, or
 * the day is in the future — and one sentence is true of both. The copy it
 * replaced ("This day's log is locked") was also wrong on a future day, which
 * has no log to lock.
 */
const COPY: Record<LockedDayReason, string> = {
  locked: "This day is locked.",
  "today-no-plan": "There's no plan scheduled for today yet.",
};

/**
 * The notice can take the focus (`ref`, `tabIndex={-1}`, out of the tab
 * order): a page whose day locks underneath a write moves the focus here from
 * the control it just disabled, rather than leave it on nothing.
 */
export function LockedDayNotice({ reason, ref }: LockedDayNoticeProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
    >
      {COPY[reason]}
    </div>
  );
}
