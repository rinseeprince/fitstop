"use client";

import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { SECTION_LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import {
  ReviewBlock,
  ReviewProse,
} from "@/components/clients/check-ins/review-block";
import type { CheckIn } from "@/types/check-in";

type ClientNotesSectionProps = {
  checkIn: CheckIn;
};

/**
 * The client's own words. Three blocks through the shared review primitive
 * since C4 — before, Reflection wore `LABEL_CLASS` and a teal left border while
 * Wins and Challenges wore a hand-rolled 12px semibold label and none, so one
 * card carried two label treatments and the rail beside it carried two more.
 *
 * `ReviewProse` also brings `whitespace-pre-wrap`, which is why a client's line
 * breaks survive here now: this is free text they typed into a textarea, and
 * the old `<p>` collapsed every one of them into a single run.
 *
 * The BORDERED, animated card shell is deliberate and temporary — it matches
 * the four sibling section cards beside it. All five are owed the borderless
 * treatment the AI review card took (D7.3); doing one of five here would have
 * made the column look broken rather than consistent.
 */
export const ClientNotesSection = ({ checkIn }: ClientNotesSectionProps) => {
  const hasContent = checkIn.notes || checkIn.prs || checkIn.challenges;
  if (!hasContent) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.12 }}
      className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-5"
    >
      <div className={cn(SECTION_LABEL_CLASS, "mb-4 flex items-center gap-2")}>
        <MessageSquare className="w-4 h-4" strokeWidth={1.5} />
        Client Notes
      </div>

      <div className="flex flex-col gap-5">
        {checkIn.notes && (
          <ReviewBlock label="Reflection">
            <ReviewProse>{checkIn.notes}</ReviewProse>
          </ReviewBlock>
        )}

        {checkIn.prs && (
          <ReviewBlock label="Wins">
            <ReviewProse>{checkIn.prs}</ReviewProse>
          </ReviewBlock>
        )}

        {checkIn.challenges && (
          <ReviewBlock label="Challenges">
            <ReviewProse>{checkIn.challenges}</ReviewProse>
          </ReviewBlock>
        )}
      </div>
    </motion.div>
  );
};
