import { redirect } from "next/navigation";

// Hard-navigation fallback for the intercepted create-session route: on a
// full load the optimistic card (client-only state) is gone regardless, so
// the honest behavior is landing on the builder itself.
export default async function CreateSessionFallbackPage({
  params,
}: {
  params: Promise<{ savedPlanId: string }>;
}) {
  const { savedPlanId } = await params;
  redirect(`/dashboard/programs/${savedPlanId}`);
}
