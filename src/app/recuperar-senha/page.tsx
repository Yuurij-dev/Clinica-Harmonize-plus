import type { Metadata } from "next";
import { ForgotPasswordScreen } from "@/components/harmonize/password-reset-screens";

export const metadata: Metadata = {
  title: "Recuperar senha | Harmonize+",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
