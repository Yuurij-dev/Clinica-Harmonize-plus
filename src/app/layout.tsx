import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppRouterShell } from "@/components/harmonize/app-router-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// URL pública para resolver og:image/twitter:image (pré-visualização do WhatsApp). NEXT_PUBLIC_SITE_URL tem prioridade;
// na Vercel usa o domínio de produção do projeto; em desenvolvimento, localhost.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Harmonize+ | Gestão inteligente para clínicas de harmonização facial",
  description:
    "SaaS para gestão de clínicas de harmonização facial com controle de custo real por atendimento.",
  openGraph: {
    title: "Harmonize+",
    description: "Gestão inteligente para clínicas de estética e harmonização.",
    siteName: "Harmonize+",
    locale: "pt_BR",
    type: "website",
    images: [{ url: "/brand/whatsapp.png", width: 1080, height: 1080, alt: "Harmonize+" }],
  },
  twitter: {
    card: "summary",
    title: "Harmonize+",
    description: "Gestão inteligente para clínicas de estética e harmonização.",
    images: ["/brand/whatsapp.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#5147DC",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head />
      <body className="min-h-full flex flex-col">
        <Script id="harmonize-theme" strategy="beforeInteractive">{`(() => { try { if (window.location.pathname === "/login") return; var saved = window.localStorage.getItem("harmonize-theme"); var dark = saved === "dark" || saved === "light" ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches; if (dark) document.documentElement.classList.add("dark"); } catch {} })();`}</Script>
        <Script id="disable-browser-autocomplete" strategy="beforeInteractive">{`(() => {
          const disableAutocomplete = (element) => {
            if (!(element instanceof Element)) return;
            if (element instanceof HTMLFormElement && element.autocomplete !== "off") element.autocomplete = "off";
            if (element instanceof HTMLInputElement && !["hidden", "password", "submit", "button", "reset", "image", "checkbox", "radio", "file"].includes(element.type) && element.autocomplete !== "off") element.autocomplete = "off";
            if (element instanceof HTMLTextAreaElement && element.autocomplete !== "off") element.autocomplete = "off";
            element.querySelectorAll?.("form, input, textarea").forEach(disableAutocomplete);
          };
          const prepareTarget = (event) => {
            if (!(event.target instanceof Element)) return;
            const field = event.target.closest("input, textarea");
            if (field) {
              disableAutocomplete(field);
              if (field instanceof HTMLInputElement && field.form) disableAutocomplete(field.form);
            }
          };
          document.addEventListener("pointerdown", prepareTarget, true);
          document.addEventListener("focusin", prepareTarget, true);
          new MutationObserver((records) => records.forEach((record) => {
            if (record.type === "attributes") disableAutocomplete(record.target);
            else record.addedNodes.forEach(disableAutocomplete);
          })).observe(document.documentElement, { attributes: true, attributeFilter: ["autocomplete"], childList: true, subtree: true });
          disableAutocomplete(document.documentElement);
        })();`}</Script>
        <AppRouterShell>{children}</AppRouterShell>
      </body>
    </html>
  );
}
