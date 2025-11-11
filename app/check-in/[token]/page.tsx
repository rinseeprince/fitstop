import { redirect } from "next/navigation";
import { CheckInForm } from "@/components/check-in/check-in-form";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function CheckInPage({ params }: PageProps) {
  const { token } = await params;

  // Validate token
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/check-in/submit/${token}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  if (!response.ok) {
    redirect("/");
  }

  const data = await response.json();

  if (!data.valid || !data.clientInfo) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container max-w-3xl mx-auto px-4 py-12">
        <CheckInForm token={token} clientInfo={data.clientInfo} />
      </div>
    </div>
  );
}
