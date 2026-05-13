import Link from "next/link";

import type { PhaseSummary } from "@/types/client-day";

type Props = {
  phase: PhaseSummary | null;
};

export function PhaseBanner({ phase }: Props) {
  if (!phase) return null;

  const title =
    phase.state === "transitioning" ? `Next: ${phase.name}` : phase.name;
  const subtitle =
    phase.state === "transitioning"
      ? "Starting soon"
      : phase.weekInPhase !== null
        ? `Week ${phase.weekInPhase}`
        : null;

  return (
    <Link
      href="/client/program"
      prefetch={false}
      aria-label={`Phase: ${title}`}
      className="mb-2 block rounded-md border border-border bg-card p-3 transition hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Phase
      </div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {subtitle ? (
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      ) : null}
      {phase.goal ? (
        <div className="mt-1 text-sm text-foreground">{phase.goal}</div>
      ) : null}
    </Link>
  );
}
