import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Harmonize+ | Gestão inteligente para clínicas de harmonização facial",
  description:
    "SaaS para gestão de clínicas de harmonização facial com controle de custo real por atendimento.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(() => { try { if (window.location.pathname !== "/login" && window.localStorage.getItem("harmonize-theme") === "dark") document.documentElement.classList.add("dark"); } catch {} })();` }} />
      </head>
      <body className="min-h-full flex flex-col"><AppRouterShell>{children}</AppRouterShell></body>
    </html>
  );
}
