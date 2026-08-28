"use client";

import type { ReactNode } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Dumbbell,
  Flag,
  HeartPulse,
  ListChecks,
  Utensils,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { alertDestination } from "@/lib/attention-alert-destinations";
import { alertLines, visibleAlerts } from "@/lib/attention-alert-copy";
import {
  LABEL_CLASS,
  MONO_META_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { OverviewCard } from "./overview-primitives";
import { relativeDayPhrase } from "./overview-format";
import type { ClientTab } from "@/lib/client-tabs";
import type { AlertSeverity, AlertType, AttentionAlert } from "@/types/attention-feed";
import type { BlockEnding, UnreviewedCheckIn } from "@/types/coach-brief";

type NeedsAttentionSectionProps = {
  clientName: string;
  unreviewedCheckIn: UnreviewedCheckIn;
  attentionAlerts: AttentionAlert[];
  /** The current journey block entering its final 7 days — a coach-action
   *  row, not an alert: no dismiss, it clears when the next block starts. */
  blockEnding: BlockEnding;
  onTabChange: (tab: ClientTab, extraParams?: Record<string, string>) => void;
  /**
   * Dismisses one alert type for this client. Dismissal is shared with the coach
   * dashboard's feed — the same `attention_dismissals` row drives both — and it
   * lapses when a newer day trips the same trigger again.
   */
  onDismissAlert: (alertType: AlertType) => void;
};

/**
 * The thumb icon names the DESTINATION, not the alert type: an alert's whole
 * job is to send the coach somewhere, and eleven types share four destinations.
 * Keyed on `alertDestination(type).tab` so a new trigger inherits an icon from
 * the map that already decides where it leads, instead of needing a row here.
 */
const DESTINATION_ICON: Record<string, ReactNode> = {
  training: <Dumbbell className="h-4 w-4" strokeWidth={1.5} />,
  nutrition: <Utensils className="h-4 w-4" strokeWidth={1.5} />,
  wellness: <HeartPulse className="h-4 w-4" strokeWidth={1.5} />,
  "daily-habits": <ListChecks className="h-4 w-4" strokeWidth={1.5} />,
};

// There is no filled red anywhere in the system, so severity reads as a thumb
// tint: the warning wash for anything actionable, the standard teal thumb for
// low. High and medium share the wash deliberately — the ORDER carries the rest
// of the distinction, and two amber intensities on 30px squares do not read.
const SEVERITY_THUMB: Record<AlertSeverity, string> = {
  high: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
  medium: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
  low: THUMB_CLASS,
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

// Sentence prose, so the weekday stays sans like the words around it.
const endsWeekday = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });

/**
 * One row: thumb, two lines, and the destination it leads to.
 *
 * The action is a text label rather than a button, for every row including the
 * check-in. A column of outline buttons made three rows of equal visual weight
 * out of a list whose whole job is priority order.
 */
function AttentionRow({
  thumb,
  icon,
  title,
  sub,
  subIsNumeric,
  action,
  onOpen,
  onDismiss,
  dismissLabel,
}: {
  thumb: string;
  icon: ReactNode;
  title: ReactNode;
  sub: ReactNode;
  subIsNumeric?: boolean;
  action: string;
  onOpen: () => void;
  /** Absent on coach-action rows, which are not dismissible alerts. */
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    // The row navigates and the × dismisses, so they are siblings — a button
    // cannot legally contain another button.
    <div className="group/alert flex items-center rounded-[6px] transition-colors hover:bg-[rgba(13,148,136,0.03)]">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2.5 text-left"
      >
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[6px]", thumb)}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[#0c1a1e]">{title}</span>
          {sub && (
            <span
              className={cn(
                "mt-0.5 block truncate text-[11px]",
                subIsNumeric ? MONO_META_CLASS : "text-[#93b0b4]"
              )}
            >
              {sub}
            </span>
          )}
        </span>
        <span
          className={cn(
            LABEL_CLASS,
            "shrink-0 transition-colors group-hover/alert:text-[#0d9488]"
          )}
        >
          {action}
        </span>
      </button>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss this alert"
          aria-label={dismissLabel}
          className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[#93b0b4] opacity-0 transition-opacity duration-150 hover:bg-[#f0f5f4] hover:text-[#5a7d82] focus-visible:opacity-100 group-hover/alert:opacity-100"
        >
          <X className="h-[15px] w-[15px]" strokeWidth={1.5} />
        </button>
      ) : (
        // Keeps the action labels in one column whether or not a row can be
        // dismissed; without it the coach-action rows sit 32px further right.
        <span className="mr-1 h-7 w-7 shrink-0" aria-hidden />
      )}
    </div>
  );
}

export function NeedsAttentionSection({
  clientName,
  unreviewedCheckIn,
  attentionAlerts,
  blockEnding,
  onTabChange,
  onDismissAlert,
}: NeedsAttentionSectionProps) {
  // `no_log_gap` is hidden while `no_engagement` is live — the second is
  // strictly stronger and the coach was reading two rows about one silence.
  // Renderer-only: the dismissal store stays 1:1 and the suppressed alert
  // returns by itself the moment `no_engagement` clears.
  const alerts = visibleAlerts(attentionAlerts);
  const sortedAlerts = [...alerts].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
  const pendingCount =
    sortedAlerts.length + (unreviewedCheckIn ? 1 : 0) + (blockEnding ? 1 : 0);
  const submitted = unreviewedCheckIn ? relativeDayPhrase(unreviewedCheckIn.submittedAt) : null;

  return (
    <div className="flex flex-1 flex-col">
      <SectionLabel
        label="Needs attention"
        meta={pendingCount > 0 ? String(pendingCount) : undefined}
      />

      <OverviewCard className="flex-1" animationDelay="0.06s">
        {pendingCount === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-[#0d9488] opacity-50" strokeWidth={1.5} />
            <p className="mt-2 text-sm text-[#5a7d82]">You&apos;re caught up on {clientName}</p>
          </div>
        ) : (
          <div className="px-3 py-3">
            {unreviewedCheckIn && (
              <AttentionRow
                thumb={THUMB_CLASS}
                icon={<ClipboardCheck className="h-4 w-4" strokeWidth={1.5} />}
                title="Check-in awaiting review"
                sub={submitted ? `Submitted ${submitted.text}` : null}
                subIsNumeric={submitted?.isNumeric}
                action="Review"
                onOpen={() => onTabChange("check-ins")}
              />
            )}

            {blockEnding && (
              // A coach-action row, not an alert: not dismissible, never on the
              // dashboard feed, and it clears when the next block starts. The
              // `{ journey: "blocks" }` round trip is a client-page URL
              // contract, not a decoration.
              <AttentionRow
                thumb={THUMB_CLASS}
                icon={<Flag className="h-4 w-4" strokeWidth={1.5} />}
                title={`${blockEnding.blockName} ends ${endsWeekday(blockEnding.endsOn)}.`}
                sub={
                  blockEnding.nextBlockName
                    ? `${blockEnding.nextBlockName} is next.`
                    : "Nothing scheduled after it."
                }
                action="Journey"
                onOpen={() => onTabChange("metrics", { journey: "blocks" })}
              />
            )}

            {sortedAlerts.map((alert, i) => {
              const destination = alertDestination(alert.type);
              // Title and sub come from the dashboard's own copy functions, so
              // the two surfaces cannot describe one alert differently. `sub`
              // is null when the fuller sentence would only repeat the
              // headline — a row printing the same string twice reads as a bug.
              const { title, sub } = alertLines(alert);
              return (
                <AttentionRow
                  key={`${alert.type}-${i}`}
                  thumb={SEVERITY_THUMB[alert.severity] ?? SEVERITY_THUMB.low}
                  icon={DESTINATION_ICON[destination.tab]}
                  title={title}
                  sub={sub}
                  action={destination.label}
                  onOpen={() => onTabChange(destination.tab)}
                  onDismiss={() => onDismissAlert(alert.type)}
                  dismissLabel={`Dismiss: ${title}`}
                />
              );
            })}
          </div>
        )}
      </OverviewCard>
    </div>
  );
}
