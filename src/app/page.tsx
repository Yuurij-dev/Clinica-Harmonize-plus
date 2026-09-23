import { HarmonizeApp } from "@/components/harmonize/harmonize-app";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <HarmonizeApp />;
}
