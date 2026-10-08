"use client";

import { Suspense } from "react";
import { motion } from "framer-motion";
import {
  NewPasswordFields,
  PASSWORD_LINK_WORDING,
  ResetPasswordForm,
  type PasswordLinkLanding,
} from "@/components/auth/reset-password-form";

/**
 * The page Better Auth's password link lands on: /reset-password (rule 4) or
 * /set-password (rule 9), the same page in each one's words.
 */
export function PasswordLinkPage({ landing }: { landing: PasswordLinkLanding }) {
  const wording = PASSWORD_LINK_WORDING[landing];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-muted opacity-50" />

      {/* Animated background orbs */}
      <motion.div
        className="absolute top-20 left-20 w-64 h-64 bg-primary/10 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="bg-card border border-border rounded-lg p-8">
          {/* Header */}
          <div className="mb-8">
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-2xl font-semibold mb-2"
            >
              {wording.title}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-muted-foreground"
            >
              {wording.description}
            </motion.p>
          </div>

          {/* The link's token is read in a leaf behind its own boundary, so
              the page stays statically prerendered (CONVENTIONS §7). */}
          <Suspense fallback={<NewPasswordFields token={null} landing={landing} />}>
            <ResetPasswordForm landing={landing} />
          </Suspense>
        </div>
      </motion.div>
    </div>
  );
}
