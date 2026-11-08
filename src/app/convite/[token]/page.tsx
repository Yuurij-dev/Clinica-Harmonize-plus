import type { Metadata } from "next";
import { InviteAcceptScreen } from "@/components/harmonize/invite-accept-screen";

// Token no path: sem indexação, e os cabeçalhos Referrer-Policy/Cache-Control saem de next.config.ts.
export const metadata: Metadata = {
  title: "Convite | Harmonize+",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ google?: string | string[] }> }) {
  const { token } = await params;
  const { google } = await searchParams;
  return <InviteAcceptScreen googleStatus={typeof google === "string" ? google : undefined} token={token} />;
}
