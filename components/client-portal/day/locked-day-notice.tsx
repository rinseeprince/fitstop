/**
 * Inline notice shown on a per-day detail page when a day can't be logged. A SINGLE
 * component (not per-variant) so every detail page renders the lock UX identically — the
 * `reason` prop switches the copy. The wrapper/markup mirror the original inline notice on
 * the nutrition page so swapping it in is DOM-neutral.
 */
export type LockedDayReason = "past-logged" | "today-no-plan";

export interface LockedDayNoticeProps {
  /**
   * Which situation the notice explains. `today-no-plan` is reserved for surfaces that
   * require a plan to log against; the nutrition/wellness pages only use `past-logged`.
   */
  reason: LockedDayReason;
}

const COPY: Record<LockedDayReason, string> = {
  "past-logged": "This day's log is locked and can't be edited.",
  "today-no-plan": "There's no plan scheduled for today yet.",
};

export function LockedDayNotice({ reason }: LockedDayNoticeProps) {
  return (
    <div
      role="status"
      className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
    >
      {COPY[reason]}
    </div>
  );
}
