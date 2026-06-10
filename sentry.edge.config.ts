import * as Sentry from "@sentry/nextjs";
import { scrubHealthData } from "@/lib/sentry-scrubber";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Strip health/PII fields before sending (matches the client + server configs).
  beforeSend(event) {
    return scrubHealthData(event);
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data) {
      breadcrumb.data = scrubHealthData(breadcrumb.data);
    }
    return breadcrumb;
  },
});