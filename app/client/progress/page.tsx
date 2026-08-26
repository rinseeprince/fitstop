import { redirect } from "next/navigation";

// The progress page has been consolidated into the Metrics hub. Keep the route
// as a redirect so existing links (e.g. the legacy dashboard) still resolve.
// Kept unlinked (dead-code sweep 2026-08): no in-repo link targets it any more;
// it is the client-side twin of the /dashboard redirect stubs (ARCHITECTURE →
// Program authoring surface).
export default function ClientProgressPage() {
  redirect("/client/metrics");
}
