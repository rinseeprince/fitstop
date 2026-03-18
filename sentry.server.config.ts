import * as Sentry from "@sentry/nextjs";
import { scrubHealthData } from "@/lib/sentry-scrubber";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Strip health/PII data before sending to Sentry
  beforeSend(event) {
    return scrubHealthData(event);
  },

  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data) {
      breadcrumb.data = scrubHealthData(breadcrumb.data);
    }
    return breadcrumb;
  },

  // Uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: process.env.NODE_ENV === 'development',
});