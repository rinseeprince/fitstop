/**
 * Path prefixes exempt from the typography-label gate (scripts/check-labels.ts).
 *
 * Two kinds of entries, and ONLY these two:
 *   1. Out-of-scope trees — client-facing web harness (RN is the real client),
 *      frozen legacy, and pages not yet migrated to Teal-Summit. When one of
 *      these migrates, DELETE its entry so the gate starts covering it.
 *   2. Infrastructure — files that must name the font for wiring reasons.
 *
 * Do NOT add an entry to silence a violation in coach-surface code — the fix
 * is importing a token from builder-tokens.ts (see docs/newdesignsystem.md,
 * "Typography").
 */
export const LABEL_WHITELIST: readonly string[] = [
  // -- Infrastructure ---------------------------------------------------------
  "app/layout.tsx", // wires JetBrains_Mono to the --font-mono-display variable

  // -- Client-facing web harness (throwaway; React Native is the real client) --
  "components/client/",
  "components/client-portal/",
  "app/client/",

  // -- Frozen legacy (coach-side, being retired) -------------------------------
  "components/clients/daily-pulse/",

  // -- Legacy pages not yet migrated to Teal-Summit ----------------------------
  "app/automation/page.tsx",
  "components/automation-rule-card.tsx",
  "app/crm/page.tsx",
  "components/lead-card.tsx",
  "app/login/page.tsx",
  "app/signup/page.tsx",
  "app/settings/page.tsx",
  "app/invite/",
  "app/(marketing)/",
  "components/marketing/",
  "components/content/",
  "components/navbar/",
];
