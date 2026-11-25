import type { Metadata } from "next";
import { ResetPasswordScreen } from "@/components/harmonize/password-reset-screens";

// O token chega no fragmento (#token=...), lido só no navegador. Headers extras em next.config.ts.
export const metadata: Metadata = {
  title: "Redefinir senha | Harmonize+",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return <ResetPasswordScreen />;
}
