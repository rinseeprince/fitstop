"use client";

import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { CheckIn } from "@/types/check-in";

type ClientNotesSectionProps = {
  checkIn: CheckIn;
};

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

      <div className="flex flex-col gap-3">
        {checkIn.notes && (
          <div>
            <div className={cn(LABEL_CLASS, "mb-1")}>
              Reflection
            </div>
            <div className="pl-3.5 border-l-2 border-[rgba(13,148,136,0.15)] text-sm text-[#0c1a1e] leading-relaxed">
              {checkIn.notes}
            </div>
          </div>
        )}

        {checkIn.prs && (
          <div>
            <div className="text-xs font-semibold text-[#5a7d82] mb-1">
              Wins
            </div>
            <div className="text-sm text-[#0c1a1e] leading-relaxed">
              {checkIn.prs}
            </div>
          </div>
        )}

        {checkIn.challenges && (
          <div>
            <div className="text-xs font-semibold text-[#5a7d82] mb-1">
              Challenges
            </div>
            <div className="text-sm text-[#0c1a1e] leading-relaxed">
              {checkIn.challenges}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};
