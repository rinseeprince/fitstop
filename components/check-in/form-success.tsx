"use client";

import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

type FormSuccessProps = {
  clientName: string;
  coachName: string;
};

export const FormSuccess = ({ clientName, coachName }: FormSuccessProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", duration: 0.6 }}
        className="relative mb-8"
      >
        <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400" />
        </div>

        <motion.div
          className="absolute -inset-2 rounded-full border-4 border-green-500/20"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-center max-w-md"
      >
        <h2 className="text-2xl font-bold text-foreground mb-3">
          Check-in Submitted!
        </h2>

        <p className="text-muted-foreground mb-6">
          Thanks {clientName}! Your check-in has been sent to {coachName}.
        </p>

        <div className="glass-card p-4 space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
            <p className="text-left text-muted-foreground">
              {coachName} will review your progress and respond soon
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
            <p className="text-left text-muted-foreground">
              You'll receive an email with feedback and next steps
            </p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
            <p className="text-left text-muted-foreground">
              Keep up the great work!
            </p>
          </div>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          You can close this page now
        </p>
      </motion.div>
    </div>
  );
};
