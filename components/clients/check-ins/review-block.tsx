import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";

/**
 * One presentation for every block of a check-in review.
 *
 * The review rail used to render its four blocks in four visual languages —
 * two teal-wash cards with 14px medium titles, and two bare divs with 14px
 * SEMIBOLD `h4`s — while the Client Notes card added two more label treatments
 * beside them. Nothing distinguished the blocks except which one someone
 * happened to build first, so the rail read as four unrelated widgets rather
 * than one review.
 *
 * These three pieces are the whole vocabulary: a labelled block, a run of
 * prose, and a marked list. A new block composes them; it does not invent a
 * fifth label size.
 *
 * Lives here, in the coach folder, and is imported BY the mixed
 * `components/check-in/` tree — not the other way round. That tree still holds
 * client-facing wizard steps with their own importers, so it is not relocated
 * (plan §2.7).
 */

export function ReviewBlock({
  label,
  actions,
  children,
}: {
  label: string;
  /** Right-hand slot on the label row — the Share block's Send/Edit/Copy. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className={LABEL_CLASS}>{label}</span>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * A run of body text. `whitespace-pre-wrap` is the point, not a detail: every
 * string here is either the client's own typing or an AI draft, and both carry
 * line breaks that the old `<p>`s collapsed. Same treatment the coach notes
 * card and the Notes tab already use.
 *
 * `tone` is the ONE axis this vocabulary varies prose on, added for the coach's
 * custom questions: a question and its answer are both prose, and the pair is
 * separated by COLOUR rather than by size or case. The alternative — putting a
 * 300-character question in the label slot — would have set a sentence in 10px
 * uppercase, which is a category treatment applied to something that is not a
 * category. Colour is already how this system mutes things, so no fifth label
 * size is needed.
 */
export function ReviewProse({
  children,
  tone = "ink",
}: {
  children: ReactNode;
  tone?: "ink" | "muted";
}) {
  return (
    <p
      className={cn(
        "text-[13px] leading-relaxed whitespace-pre-wrap",
        tone === "muted" ? TEXT_MUTED : TEXT_PRIMARY
      )}
    >
      {children}
    </p>
  );
}

export function ReviewList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

/**
 * One list row. The marker sits in a fixed-width slot so text left-aligns down
 * the column whatever the marker is — a 16px icon for a watch item, a 6px dot
 * for a coach action. Ragged text was the old rail's other tell.
 */
export function ReviewListRow({
  marker,
  children,
}: {
  marker: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className={cn("flex items-start gap-2.5 text-[13px] leading-relaxed", TEXT_PRIMARY)}>
      <span className="flex h-[19px] w-4 shrink-0 items-center justify-center">
        {marker}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
