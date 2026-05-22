import { redirect } from "next/navigation";

// The progress page has been consolidated into the Metrics hub. Keep the route
// as a redirect so existing links (e.g. the legacy dashboard) still resolve.
export default function ClientProgressPage() {
  redirect("/client/metrics");
}
