"use client";

import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
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
      className="bg-card border border-border rounded-lg p-5"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4 flex items-center gap-2">
        <MessageSquare className="w-4 h-4" />
        Client Notes
      </div>

      <div className="flex flex-col gap-3">
        {checkIn.notes && (
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Reflection
            </div>
            <div className="pl-3.5 border-l-2 border-border text-sm text-foreground leading-relaxed">
              {checkIn.notes}
            </div>
          </div>
        )}

        {checkIn.prs && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1">
              Wins
            </div>
            <div className="text-sm text-foreground leading-relaxed">
              {checkIn.prs}
            </div>
          </div>
        )}

        {checkIn.challenges && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1">
              Challenges
            </div>
            <div className="text-sm text-foreground leading-relaxed">
              {checkIn.challenges}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};
