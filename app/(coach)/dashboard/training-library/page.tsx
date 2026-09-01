import { redirect } from "next/navigation";

// The training library was absorbed into the Programs surface (builder S2.5).
// Keep the route as a redirect so existing links still resolve.
export default function TrainingLibraryPage() {
  redirect("/dashboard/programs");
}
