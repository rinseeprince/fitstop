import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";

/**
 * One presentation for every block of a check-in review. These two pieces are
 * the whole vocabulary: a labelled block and a run of prose. A new block
 * composes them; it does not invent another label size.
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
 * string here is either the client's own typing or the coach's reply, and both
 * carry line breaks that the old `<p>`s collapsed. Same treatment the coach notes
 * card and the Notes tab already use.
 *
 * `tone` is the ONE axis this vocabulary varies prose on, added for the coach's
 * custom questions: a question and its answer are both prose, and the pair is
 * separated by COLOUR rather than by size or case. The alternative — putting a
 * 300-character question in the label slot — would have set a sentence in 10px
 * uppercase, which is a category treatment applied to something that is not a
 * category. Colour is already how this system mutes things, so no new label
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
