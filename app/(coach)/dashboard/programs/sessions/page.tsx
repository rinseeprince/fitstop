import { redirect } from "next/navigation";

// Retired in S4.5 — standalone session management folded into the builder's
// left library panel (Sessions tab). Kept as a redirect so old links/bookmarks
// land on the Programs list instead of 404ing.
export default function SessionsRedirectPage() {
  redirect("/dashboard/programs");
}
