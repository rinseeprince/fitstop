import { redirect } from "next/navigation";

// Retired in S4.5 — exercise-catalog management folded into the builder's
// left library panel (Exercises tab). Kept as a redirect so old links/bookmarks
// land on the Programs list instead of 404ing.
export default function ExercisesRedirectPage() {
  redirect("/dashboard/programs");
}
