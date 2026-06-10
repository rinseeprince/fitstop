// This file configures the initialization of Sentry on the client.
// It is the SINGLE source of truth for browser-side Sentry: under Next 16 /
// Turbopack only this file's Sentry.init runs (the old sentry.client.config.ts was
// deleted). The added config here is used whenever a user loads a page.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubHealthData } from "@/lib/sentry-scrubber";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 10% of transactions (matches the server/edge configs). NOT 100%.
  tracesSampleRate: 0.1,
  enableLogs: true,

  // This is a health app — do NOT auto-attach user PII (IP, headers, cookies).
  sendDefaultPii: false,

  // Strip health/PII fields (weight, body fat, calories, mood, notes, etc.) from
  // events and breadcrumbs before they leave the browser. See lib/sentry-scrubber.
  beforeSend(event) {
    return scrubHealthData(event);
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data) {
      breadcrumb.data = scrubHealthData(breadcrumb.data);
    }
    return breadcrumb;
  },

  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
